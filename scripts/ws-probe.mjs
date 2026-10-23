import WebSocket from "ws";

const url = process.argv[2] ?? "wss://dynofreechat-api.nbk2124-z.workers.dev/ws?r=demo";
const ws = new WebSocket(url, { origin: "https://realkhoa.github.io", handshakeTimeout: 5000, perMessageDeflate: false });

ws.on("open", () => {
  console.log("OPEN");
  ws.send(JSON.stringify({ t: "join", nick: "probe", color: "hsl(200 60% 60%)" }));
});
ws.on("message", (data) => {
  console.log("FRAME", String(data).slice(0, 200));
  ws.close();
});
ws.on("unexpected-response", (_req, res) => {
  console.log("HTTP", res.statusCode);
  res.on("data", (chunk) => console.log("BODY", String(chunk).slice(0, 200)));
});
ws.on("error", (error) => console.log("ERR", error.message));
ws.on("close", (code, reason, wasClean) => console.log("CLOSE", code, String(reason).slice(0, 80), "clean=" + wasClean));
setTimeout(() => process.exit(0), 7000);
