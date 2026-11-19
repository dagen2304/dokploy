import {
	CONDITIONS,
	CONDITIONS_UPDATED_AT,
} from "@/components/olympe/legal/conditions";
import { LegalPage } from "@/components/olympe/legal/legal-page";

export default function Conditions() {
	return (
		<LegalPage
			title="Conditions générales d'utilisation et de vente"
			updatedAt={CONDITIONS_UPDATED_AT}
			markdown={CONDITIONS}
		/>
	);
}
