import { StakeDashboard } from "@/components/stake/stake-dashboard";
import { PageIntro } from "@/components/page-intro";
import { pageIntro } from "@/lib/ui/product-copy";

export default function StakePage() {
  return (
    <div className="space-y-10">
      <PageIntro title="Stake ve ödüller" description={pageIntro.stake} />
      <StakeDashboard />
    </div>
  );
}
