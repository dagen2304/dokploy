import {
	PRIVACY,
	PRIVACY_UPDATED_AT,
} from "@/components/olympe/legal/confidentialite";
import { LegalPage } from "@/components/olympe/legal/legal-page";

export default function Confidentialite() {
	return (
		<LegalPage
			title="Politique de confidentialité"
			updatedAt={PRIVACY_UPDATED_AT}
			markdown={PRIVACY}
		/>
	);
}
