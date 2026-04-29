export type AdapterStatusKind = "pending" | "active" | "rejected";

/** Prisma `AdapterStatus` ile birebir (backend string). */
export function getAdapterStatusKind(status: string): AdapterStatusKind {
  switch (status) {
    case "ACTIVE":
      return "active";
    case "REJECTED":
    case "SLASHED":
    case "DEPRECATED":
      return "rejected";
    case "PENDING_REVIEW":
    default:
      return "pending";
  }
}

export function statusBadgeLabel(kind: AdapterStatusKind): string {
  switch (kind) {
    case "active":
      return "Aktif";
    case "rejected":
      return "Reddedildi";
    default:
      return "İncelemede";
  }
}
