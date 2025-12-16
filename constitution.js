export const NFT_FACE_VALUE_LADDER = [
  250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000,
  220000, 380000, 600000, 850000, 1000000
];

export function assertFaceValueAllowed(value) {
  if (!NFT_FACE_VALUE_LADDER.includes(value)) throw new Error("FACE_VALUE_NOT_ALLOWED");
}

export const LV_RATE = 0.10;
export const UV_RATE = 0.90;

export function splitLvUv(faceValue) {
  assertFaceValueAllowed(faceValue);
  const lv = Math.round(faceValue * LV_RATE);
  const uv = faceValue - lv;
  return { lv, uv };
}

export const CASH_OUT_TABLE = {
  1: { collaboratorUvPct: 0.30, trebalUvPct: 0.70 },
  2: { collaboratorUvPct: 0.35, trebalUvPct: 0.65 },
  3: { collaboratorUvPct: 0.40, trebalUvPct: 0.60 },
  4: { collaboratorUvPct: 0.45, trebalUvPct: 0.55 },
  5: { collaboratorUvPct: 0.50, trebalUvPct: 0.50 }
};

export function cashOutSplit(batchCount, uv) {
  const row = CASH_OUT_TABLE[batchCount];
  if (!row) throw new Error("INVALID_BATCH_COUNT");
  const collaboratorPayout = Math.floor(uv * row.collaboratorUvPct);
  const trebalCapture = uv - collaboratorPayout;
  return { collaboratorPayout, trebalCapture };
}

export function sponsorshipSplit(uv) {
  const collaborator = Math.floor(uv * 0.50);
  const seller = Math.floor(uv * 0.25);
  const retained = uv - collaborator - seller;
  return { collaborator, seller, retained };
}

export function distributionInternalAllocationFromUv(uvOriginal) {
  const platformFee = Math.floor(uvOriginal * 0.10);
  const discountPool = Math.floor(uvOriginal * 0.15);
  return { platformFee, discountPool };
}

export function computeSellerClass(sem) {
  if (sem >= 300) return "A";
  if (sem >= 150) return "B";
  if (sem >= 80) return "C";
  if (sem >= 40) return "D";
  return "E";
}

export const DECAY_RATE_BY_CLASS = { A: 0.04, B: 0.08, C: 0.12, D: 0.15, E: 0.0 };
export const DISTRIBUTION_TERMINAL_THRESHOLD = 40;

export function assertSellerCanDistribute(sellerClass) {
  if (sellerClass === "E") throw new Error("SELLER_CLASS_E_NOT_PERMITTED");
}
