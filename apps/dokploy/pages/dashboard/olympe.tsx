import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { OperatorPage } from "@/components/olympe/operator-page";
import { requireSession } from "@/components/olympe/ssr";

const Page = () => <OperatorPage />;

export default Page;

Page.getLayout = (page: ReactElement) => (
	<DashboardLayout metaName="Clients Olympe">{page}</DashboardLayout>
);

export const getServerSideProps = (ctx: GetServerSidePropsContext) =>
	requireSession(ctx);
