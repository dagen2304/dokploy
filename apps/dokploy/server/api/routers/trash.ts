import {
	deleteTrashItem,
	getTrashSnapshot,
	listTrash,
	restoreFromTrash,
	TrashRestoreError,
} from "@dokploy/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";

// KTC fork: restoring brings back secrets and routes, so only owners and
// admins can see or use the trash.
export const trashRouter = createTRPCRouter({
	list: adminProcedure
		.input(z.object({ environmentId: z.string().optional() }))
		.query(({ ctx, input }) =>
			listTrash(ctx.session.activeOrganizationId, input.environmentId),
		),

	restore: adminProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			try {
				const snapshot = await restoreFromTrash(
					input.id,
					ctx.session.activeOrganizationId,
				);
				await audit(ctx, {
					action: "create",
					resourceType: "service",
					resourceId: snapshot.id,
					resourceName: snapshot.appName,
				});
				return { type: snapshot.type, id: snapshot.id };
			} catch (error) {
				if (error instanceof TrashRestoreError) {
					throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
				}
				throw error;
			}
		}),

	remove: adminProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const snapshot = await getTrashSnapshot(
				input.id,
				ctx.session.activeOrganizationId,
			);
			if (!snapshot) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Not in the trash" });
			}
			await deleteTrashItem(input.id);
			return true;
		}),
});
