import { server } from "../server.js";

export default function handler(req, res) {
  server.emit("request", req, res);
}
