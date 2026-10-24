// v1 stays in run-agent.ts unchanged: its source is part of the frozen baseline's fingerprint,
// so editing it would make the published v1 decisions fail verification.
const args = process.argv.slice(2);
void (args[0] === "--version" && args[1] === "v2" ? import("./run-agent-v2") : import("./run-agent"));
