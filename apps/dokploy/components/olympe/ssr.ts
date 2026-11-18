import { validateRequest } from "@dokploy/server";
import type { GetServerSidePropsContext } from "next";

export const requireSession = async (ctx: GetServerSidePropsContext) => {
	const { user } = await validateRequest(ctx.req);
	if (!user) {
		return { redirect: { permanent: false, destination: "/" } };
	}
	return { props: {} };
};
