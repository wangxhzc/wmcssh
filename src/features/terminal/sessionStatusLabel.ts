import type { SessionStatus } from "../../types/ssh";

export const sessionStatusLabel: Record<SessionStatus | "created", string> = {
  created: "待连接",
  connecting: "连接中", connected: "已连接", reconnecting: "重连中",
  disconnected: "已断开", closing: "关闭中", error: "连接失败"
};
