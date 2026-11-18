import { AsyncLocalStorage } from "node:async_hooks";

// Lets code deep inside a request (domain generation in templates, for
// example) know which organization the request acts for without threading it
// through every upstream function signature.
const storage = new AsyncLocalStorage<{ organizationId: string }>();

export const runWithOrganization = <T>(organizationId: string, fn: () => T) =>
	storage.run({ organizationId }, fn);

export const currentOrganizationId = () => storage.getStore()?.organizationId;
