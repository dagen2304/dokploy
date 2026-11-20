import {
	isClientOrganization,
	isMultiTenant,
	organizationIdOfService,
} from "./tenancy";

type ServiceRef = Parameters<typeof organizationIdOfService>[0];

// `docker login` writes to the Docker CLI configuration shared by every build
// on the server: a client's build would then pull with the registry
// credentials of the operator or of another client. Client builds get their
// own throwaway configuration, removed when the deployment shell exits.
const SETUP = `if [ -z "\${OLYMPE_DOCKER_CONFIG:-}" ]; then OLYMPE_DOCKER_CONFIG="$(mktemp -d /tmp/olympe-docker.XXXXXX)"; trap 'rm -rf "$OLYMPE_DOCKER_CONFIG"' EXIT; fi; export DOCKER_CONFIG="$OLYMPE_DOCKER_CONFIG";`;

export const isolatedDockerConfig = async (service: ServiceRef) => {
	if (!isMultiTenant()) return { setup: "", env: "" };
	const organizationId = await organizationIdOfService(service);
	if (!isClientOrganization(organizationId)) return { setup: "", env: "" };
	return { setup: SETUP, env: 'DOCKER_CONFIG="$OLYMPE_DOCKER_CONFIG"' };
};
