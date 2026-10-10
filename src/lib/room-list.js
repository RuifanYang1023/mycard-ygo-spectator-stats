import { MYCARD_DUEL_LIST_URL } from "./constants.js";

export function fetchStartedRooms({
  url = MYCARD_DUEL_LIST_URL,
  timeoutMs = 15000,
} = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      callback(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`获取房间列表超时: ${url}`));
    }, timeoutMs);

    ws.onopen = () => {};
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.event === "init" && Array.isArray(payload.data)) {
          finish(resolve, payload.data);
        }
      } catch {
        // ignore non-json frames
      }
    };
    ws.onerror = () => {
      finish(reject, new Error("萌卡房间列表 WebSocket 连接失败"));
    };
    ws.onclose = () => {
      finish(reject, new Error("萌卡房间列表连接已关闭"));
    };
  });
}
