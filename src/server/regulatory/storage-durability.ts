type Env = Record<string, string | undefined>;

export type StorageDurability = {
  durable: boolean;
  adapter: string;
  detail: string;
};

/**
 * 법령 폴러는 직전 baseline 텍스트를 storage에 저장해 두고 다음 폴에서 비교한다.
 * 그 텍스트가 휘발성(`/tmp`)에 있으면 재부팅 시 사라져, 스냅샷은 DB에 남았는데
 * 텍스트만 없어 `previousNormalizedText is required` 로 전건 실패한다.
 * 이 함수는 그런 위험 구성을 실행 전에 판별한다(순수 함수, 부작용 없음).
 */
export function assessRegulatoryStorageDurability(env: Env = process.env): StorageDurability {
  const adapter = env.FINPROOF_STORAGE_ADAPTER?.trim() || "local-metadata";

  if (adapter === "s3") {
    return { durable: true, adapter, detail: "S3 스토리지 — 내구성 있음" };
  }

  if (adapter === "local-metadata") {
    const dir = env.FINPROOF_LOCAL_UPLOAD_DIR?.trim() || "/tmp/finproof-uploads";
    const ephemeral = /^\/tmp(\/|$)/.test(dir) || /^\/var\/tmp(\/|$)/.test(dir);

    if (ephemeral) {
      return {
        durable: false,
        adapter,
        detail:
          `로컬 스토리지가 휘발성 경로(${dir})에 있습니다. 재부팅 시 baseline 텍스트가 사라져 ` +
          `다음 폴이 전건 실패합니다. FINPROOF_STORAGE_ADAPTER=s3 로 바꾸거나 ` +
          `FINPROOF_LOCAL_UPLOAD_DIR 을 영속 경로(예: /home/ec2-user/finproof-data)로 설정하세요.`
      };
    }

    return { durable: true, adapter, detail: `로컬 영속 경로(${dir}) — 내구성 있음` };
  }

  return { durable: false, adapter, detail: `알 수 없는 스토리지 어댑터: ${adapter}` };
}
