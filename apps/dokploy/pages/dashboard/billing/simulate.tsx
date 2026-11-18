import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { SimulatePayment } from "@/components/olympe/simulate-payment";
import { requireSession } from "@/components/olympe/ssr";

const Page = () => <SimulatePayment />;

export default Page;

Page.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Paiement">{page}</DashboardLayout>
);

export const getServerSideProps = (ctx: GetServerSidePropsContext) =>
	requireSession(ctx);
