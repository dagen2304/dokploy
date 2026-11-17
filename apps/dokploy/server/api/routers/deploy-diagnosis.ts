import {
	DiagnosisError,
	diagnoseDeployment,
	findDeploymentById,
} from "@dokploy/server";
import { checkServicePermissionAndAccess } from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

export const deployDiagnosisRouter = createTRPCRouter({
	diagnose: protectedProcedure
		.input(z.object({ deploymentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const deployment = await findDeploymentById(input.deploymentId);
			const serviceId =
				deployment.application?.applicationId ?? deployment.compose?.composeId;
			if (!serviceId) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only application and compose deployments can be analyzed",
				});
			}
			await checkServicePermissionAndAccess(ctx, serviceId, {
				deployment: ["read"],
			});

			try {
				return await diagnoseDeployment(
					input.deploymentId,
					ctx.session.activeOrganizationId,
				);
			} catch (error) {
				if (error instanceof DiagnosisError) {
					throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `The AI provider returned an error: ${error instanceof Error ? error.message : "unknown error"}`,
				});
			}
		}),
});
