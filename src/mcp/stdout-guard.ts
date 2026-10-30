// MUST be the first import of src/mcp.ts.
// stdout carries MCP protocol messages, so any stray console.log from shared modules would corrupt
// the stream. Route all console output to stderr instead.
const toStderr = (...args: unknown[]) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
console.warn = toStderr;
export {};
