/* Deterministic native process for PTY tests: no network, tokens or real accounts. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>
#include <termios.h>
#include <sys/time.h>

static const char *session;
static char transcript[4096];

static void registry(const char *name) {
    char filename[4096], command[128], stamp[128];
    snprintf(filename, sizeof(filename), "%s/sessions/%d.json", getenv("SWITCHBOARD_CLAUDE_HOME"), getpid());
    if (!strcmp(name, "SessionEnd")) {unlink(filename); return;}
    snprintf(command, sizeof(command), "/bin/ps -p %d -o lstart=", getpid());
    FILE *ps = popen(command, "r");
    if (!ps || !fgets(stamp, sizeof(stamp), ps)) exit(2);
    pclose(ps); stamp[strcspn(stamp, "\r\n")] = 0;
    struct timeval now; gettimeofday(&now, NULL);
    FILE *file = fopen(filename, "w");
    if (!file) exit(2);
    fprintf(file, "{\"pid\":%d,\"sessionId\":\"%s\",\"kind\":\"interactive\",\"procStart\":\"%s\",\"cwd\":\"%s\",\"status\":\"%s\",\"updatedAt\":%lld}",
        getpid(), session, stamp, getenv("TEST_CWD"), !strcmp(name, "UserPromptSubmit") ? "busy" : "idle", (long long)now.tv_sec * 1000 + now.tv_usec / 1000);
    fclose(file);
}

static void event(const char *name, const char *source) {
    registry(name);
    if (getenv("TEST_NATIVE_ONLY") && !strcmp(source, "startup")) return;
    int descriptors[2];
    if (pipe(descriptors)) exit(2);
    pid_t child = fork();
    if (child == 0) {
        dup2(descriptors[0], STDIN_FILENO);
        close(descriptors[0]); close(descriptors[1]);
        execl(getenv("TEST_NODE"), getenv("TEST_NODE"), getenv("TEST_HOOK"), name, NULL);
        _exit(2);
    }
    close(descriptors[0]);
    FILE *input = fdopen(descriptors[1], "w");
    fprintf(input, "{\"session_id\":\"%s\",\"transcript_path\":\"%s\",\"cwd\":\"%s\",\"source\":\"%s\",\"background_tasks\":[],\"session_crons\":[]}\n", session, transcript, getenv("TEST_CWD"), source);
    fclose(input);
    waitpid(child, NULL, 0);
}

static void log_line(const char *text) {
    FILE *file = fopen(transcript, "a");
    if (!file) exit(2);
    fprintf(file, "{\"event\":\"%s\"}\n", text); fclose(file);
}

int main(int argc, char **argv) {
    if (argc > 2 && strcmp(argv[1], "auth") == 0) {
        const char *dir = getenv("CLAUDE_CONFIG_DIR");
        printf("{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"email\":\"%s@example.test\",\"subscriptionType\":\"pro\"}\n", dir && strstr(dir, "/profiles/") ? "second" : "first");
        return 0;
    }
    struct termios terminal;
    if (tcgetattr(0, &terminal) == 0) {
        terminal.c_lflag |= ICANON | ECHO | ISIG;
        terminal.c_iflag |= ICRNL;
        tcsetattr(0, TCSANOW, &terminal);
    }
    const char *source = "startup";
    session = getenv("TEST_SESSION");
    for (int i = 1; i + 1 < argc; i++) if (strcmp(argv[i], "--resume") == 0) {session = argv[i + 1]; source = "resume";}
    if (!session) return 2;
    snprintf(transcript, sizeof(transcript), "%s/projects/%s.jsonl", getenv("SWITCHBOARD_CLAUDE_HOME"), session);
    if (!strcmp(source, "resume") && access(transcript, R_OK)) return 3;
    log_line(source); event("SessionStart", source);
    printf("FAKE_READY %s\n❯ ", session); fflush(stdout);
    char line[1024];
    while (fgets(line, sizeof(line), stdin)) {
        if (!strncmp(line, "/exit", 5)) {log_line("exit"); event("SessionEnd", source); return 0;}
        event("UserPromptSubmit", source); log_line("working");
        sleep(6);
        log_line("answer-finished"); event("Stop", source);
        printf("FAKE_DONE\n❯ "); fflush(stdout);
    }
    return 0;
}
