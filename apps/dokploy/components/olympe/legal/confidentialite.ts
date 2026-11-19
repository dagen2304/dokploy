// Mirror of the reviewed document "Olympe — Politique de confidentialité".
// Edit the document first, then copy the text here.
export const PRIVACY_UPDATED_AT = "19 novembre 2026";

export const PRIVACY = `## 1. Qui est responsable de vos données

Le responsable du traitement des données décrites ici est **KTC**, [forme juridique et adresse du siège — À COMPLÉTER], qui édite et exploite Olympe. Pour toute question sur vos données : [adresse e-mail dédiée, par exemple privacy@ktc-org.com — À COMPLÉTER].

Cette politique s'applique aux personnes qui créent un compte sur Olympe, aux membres invités dans un espace et aux visiteurs des pages de connexion et d'inscription.

## 2. Données collectées, pourquoi et combien de temps

Olympe ne collecte que ce qui sert à fournir le service, à le facturer et à le protéger contre les abus. Aucune donnée n'est vendue ni utilisée à des fins publicitaires.

| Données | Pourquoi | Base | Conservation |
| --- | --- | --- | --- |
| Prénom, nom, adresse e-mail, mot de passe (stocké uniquement sous forme chiffrée irréversible) | Créer et sécuriser le compte, envoyer les e-mails du service | Contrat | Tant que le compte existe, puis suppression |
| Sessions de connexion : adresse IP, navigateur, date | Sécurité du compte, détection d'accès suspects | Intérêt légitime | Durée de la session, [puis 6 mois — À DÉCIDER] |
| Adresse e-mail et adresse IP à l'inscription | Limiter les inscriptions abusives et les essais multiples | Intérêt légitime | [12 mois — À DÉCIDER] |
| Forfait, montant, moyen de paiement choisi, référence du prestataire, numéro de facture | Facturer, prouver les paiements, tenir la comptabilité | Contrat et obligation légale | [10 ans — À CONFIRMER selon les règles comptables applicables] |
| Utilisation des ressources (processeur, mémoire, disque, nombre de services), journaux de déploiement | Appliquer les limites du forfait, aider au dépannage | Contrat | Tant que l'espace existe |
| Journaux de déploiement envoyés au diagnostic IA, secrets masqués | Expliquer un échec de déploiement, uniquement quand le client le demande | Demande du client | Non conservés par Olympe après la réponse |

Les numéros Mobile Money et les données de carte bancaire sont saisis chez le prestataire de paiement : Olympe ne les reçoit pas et ne les conserve pas.

## 3. Prestataires et transferts hors du pays

Olympe s'appuie sur quelques prestataires techniques. Chacun ne reçoit que les données utiles à sa mission.

| Prestataire | Rôle | Données concernées | Localisation |
| --- | --- | --- | --- |
| Contabo | Hébergement du serveur Olympe | Toutes les données de la plateforme | [pays du centre de données du VPS — À COMPLÉTER] |
| Cloudflare | Noms de domaine, protection anti-robot à l'inscription, stockage des sauvegardes | Adresse IP et signaux du navigateur à l'inscription ; sauvegardes chiffrées en transit | [À COMPLÉTER] |
| Resend | Envoi des e-mails du service | Adresse e-mail, nom, contenu des e-mails | [À COMPLÉTER selon la région choisie dans Resend] |
| Google (Gemini) | Diagnostic IA d'un déploiement, à la demande du client | Journal du déploiement, secrets masqués | [À COMPLÉTER] |
| Prestataire de paiement | Encaissement Mobile Money et carte | Données de paiement, saisies directement chez lui | [À COMPLÉTER au branchement du paiement réel] |

Certains de ces prestataires sont situés hors du pays de KTC. Ces transferts sont encadrés par les garanties prévues par la loi applicable [à préciser avec le juriste].

## 4. Les données que nos clients hébergent

Les applications et bases de données déployées par un client peuvent contenir les données personnelles de ses propres utilisateurs. Pour ces données, **le client est responsable du traitement** et KTC agit comme **sous-traitant** :

- KTC ne les traite que pour héberger, exécuter et sauvegarder les services du client, sur ses instructions ;
- KTC ne les consulte pas, sauf demande du client pour un dépannage, obligation légale, ou nécessité d'enquêter sur un abus signalé ;
- chaque espace est isolé des autres clients ;
- KTC informe le client sans délai injustifié en cas de violation de données touchant son espace ;
- à la suppression de l'espace, ces données sont effacées, sauvegardes comprises, dans un délai de [30 jours — À CONFIRMER].

C'est au client d'informer ses propres utilisateurs et de répondre à leurs demandes d'exercice de droits.

## 5. Sécurité, cookies et vos droits

**Sécurité.** Connexions chiffrées (HTTPS), mots de passe stockés sous forme chiffrée irréversible, isolation réseau entre les espaces clients, secrets masqués dans les journaux transmis au diagnostic IA, sauvegardes régulières, accès au serveur réservé à KTC.

**Cookies.** Olympe n'utilise que des cookies nécessaires : le cookie de session qui vous garde connecté, et ceux de la vérification anti-robot Cloudflare Turnstile sur la page d'inscription. Il n'y a ni cookie publicitaire ni outil de mesure d'audience tiers.

**Vos droits.** Vous pouvez demander l'accès à vos données, leur rectification, leur effacement, leur portabilité, ou vous opposer à un traitement fondé sur l'intérêt légitime. Vous pouvez modifier vos informations et supprimer votre compte depuis votre profil. Pour toute autre demande, écrivez à [adresse e-mail — À COMPLÉTER] : nous répondons sous [30 jours — À CONFIRMER]. Vous pouvez aussi saisir l'autorité de protection des données compétente [au Cameroun : l'Autorité de protection des données à caractère personnel — À CONFIRMER selon le pays du siège].

**Mineurs.** Olympe est réservé aux personnes de 18 ans et plus.

**Modifications.** En cas de changement important de cette politique, les titulaires de compte sont prévenus par e-mail avant son entrée en vigueur. Voir aussi les [conditions générales](/conditions).
`;
