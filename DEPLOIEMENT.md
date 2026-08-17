# Déployer Wangala IA sur un VPS

Cette procédure installe l’interface, l’API Agent Mode et HTTPS automatique sur un serveur Ubuntu avec Docker. Elle convient à un premier déploiement de production.

## 1. Préparer les accès

Il vous faut :

- un VPS Ubuntu récent (minimum conseillé : 2 vCPU, 4 Go de RAM) ;
- un nom de domaine ou sous-domaine ;
- une clé d’un fournisseur de modèle compatible avec l’API OpenAI `chat/completions` ;
- facultativement, une clé Tavily pour la recherche web de l’agent.

Dans la zone DNS du domaine, créez un enregistrement `A` pointant vers l’adresse IPv4 du VPS. Le port 80 et le port 443 doivent être ouverts.

## 2. Installer Docker

Connectez-vous au VPS en SSH, puis installez Docker depuis le dépôt officiel de votre distribution. Vérifiez ensuite :

```bash
docker --version
docker compose version
```

## 3. Installer Wangala IA

```bash
git clone URL_DE_VOTRE_DEPOT wangala-ia
cd wangala-ia
cp .env.wangala.example .env
chmod 600 .env
nano .env
```

Renseignez au minimum :

```dotenv
DOMAIN=ia.votre-domaine.bf
ACME_EMAIL=admin@votre-domaine.bf
LLM_API_URL=https://api.openai.com/v1
LLM_API_KEY=votre-cle-secrete
LLM_MODEL=nom-du-modele-choisi
```

Ne placez jamais la clé API dans le code du frontend ou dans Git. Elle doit rester uniquement dans le fichier `.env` du serveur.

## 4. Démarrer la plateforme

```bash
docker compose -f compose.wangala.yml up -d --build
docker compose -f compose.wangala.yml ps
docker compose -f compose.wangala.yml logs -f --tail=100
```

Caddy obtient automatiquement le certificat TLS Let’s Encrypt. Après la propagation DNS, Wangala IA devient accessible à l’adresse `https://DOMAIN`.

## 5. Vérifier

```bash
curl https://ia.votre-domaine.bf/api/health
```

Réponse attendue :

```json
{
  "status": "ok",
  "service": "wangala-ia",
  "modelConfigured": true,
  "webSearchConfigured": false
}
```

Envoyez ensuite un message depuis l’interface. Si `TAVILY_API_KEY` est renseignée, l’agent peut appeler la recherche web lorsque la demande exige des informations récentes.

## Exploitation

### Mettre à jour

```bash
git pull
docker compose -f compose.wangala.yml up -d --build
docker image prune -f
```

### Consulter les journaux

```bash
docker compose -f compose.wangala.yml logs -f wangala
docker compose -f compose.wangala.yml logs -f caddy
```

### Arrêter

```bash
docker compose -f compose.wangala.yml down
```

N’ajoutez `-v` que si vous souhaitez aussi supprimer les données et certificats gérés par Caddy.

## Sécurité avant ouverture au public

Le prototype comprend HTTPS, limitation simple du débit, exécution du conteneur sans privilèges et clés conservées côté serveur. Avant une ouverture à grande échelle, ajoutez :

1. authentification des utilisateurs ;
2. quotas par compte et suivi des coûts du modèle ;
3. stockage chiffré des conversations si elles deviennent synchronisées ;
4. modération et politique de confidentialité ;
5. sauvegardes, alertes et supervision ;
6. proxy de sécurité ou pare-feu applicatif pour une forte exposition publique.

L’historique actuel est conservé seulement dans le navigateur de l’utilisateur (`localStorage`) et n’est pas enregistré dans une base distante.
