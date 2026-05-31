import { Header } from "@/components/layout/Header";
import { BidsSection } from "@/components/bids/BidsSection";

export default function AllBids() {
  return (
    <>
      <Header title="Todas as Licitações" subtitle="Banco de dados completo de processos" />
      <main className="p-6">
        <BidsSection />
      </main>
    </>
  );
}
