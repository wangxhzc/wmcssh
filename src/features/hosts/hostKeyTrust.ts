import { sshTrustHostKey } from "../../services/tauri/sshApi";
import type { AppErrorDto } from "../../types/errors";
import { parseHostKeyChallenge } from "./hostKeyChallenge";

export async function confirmAndTrustHostKey(hostId: string, error: AppErrorDto) {
  const challenge = parseHostKeyChallenge(error);
  if (!challenge) throw new Error("无法读取服务器主机密钥信息");
  const warning = challenge.changed
    ? "警告：服务器主机密钥已发生变化。这可能是服务器重装，也可能是中间人攻击。\n\n仅在通过可信渠道核对指纹后继续。"
    : "这是首次连接该服务器。请通过可信渠道核对以下主机密钥指纹。";
  const confirmed = window.confirm(
    `${warning}\n\n主机：${challenge.hostname}:${challenge.port}\n类型：${challenge.keyType}\n指纹：${challenge.fingerprint}\n\n确认信任此密钥？`
  );
  if (!confirmed) return false;
  await sshTrustHostKey({ hostId, expectedFingerprint: challenge.fingerprint });
  return true;
}
