import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { BillingPage } from "@/components/olympe/billing-page";
import { requireSession } from "@/components/olympe/ssr";

const Page = () => <BillingPage />;

export default Page;

Page.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Facturation">{page}</DashboardLayout>
);

export const getServerSideProps = (ctx: GetServerSidePropsContext) =>
	requireSession(ctx);
