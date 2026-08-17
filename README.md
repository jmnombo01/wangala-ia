# Wangala IA

**Wangala IA** est un chat Agent Mode en français, avec une identité visuelle contemporaine inspirée des couleurs et des formes du Burkina Faso.

![Statut](https://img.shields.io/badge/version-prototype%200.1.0-0f5a43)

## Fonctionnalités du prototype

- interface responsive en français ;
- identité Wangala IA (vert, rouge, or et motifs géométriques) ;
- conversations multiples et recherche locale ;
- historique privé conservé dans le navigateur ;
- thème clair/sombre ;
- ajout de fichiers texte (`TXT`, `MD`, `CSV`, `JSON`) ;
- API serveur compatible OpenAI Chat Completions ;
- recherche web légère sans clé supplémentaire pour les questions récentes ;
- historique compacté, nouvelle tentative automatique et modèles de secours en cas de quota ;
- Tavily facultatif comme moteur de recherche supplémentaire ;
- HTTPS automatique avec Caddy ;
- déploiement Docker Compose.

## Aperçu local

```bash
cd frontend
npm install
npm run dev
```

Par défaut, le frontend démarre en **mode démonstration** : aucune clé API n’est nécessaire et les réponses servent seulement à valider l’expérience utilisateur.

## Brancher un modèle en local

Terminal 1 :

```bash
cd frontend
VITE_DEMO_MODE=false VITE_CHAT_API_URL=http://localhost:8787 npm run dev
```

Terminal 2 :

```bash
LLM_API_KEY="votre-cle" \
LLM_MODEL="votre-modele" \
STATIC_DIR="$(pwd)/frontend/dist" \
node server/server.mjs
```

Le fournisseur est configurable avec `LLM_API_URL`.

## Déploiement automatique

Le script `scripts/deploy-automatic.sh` peut créer le dépôt GitHub, envoyer le code, créer le service Render Free, configurer Groq et attendre la mise en ligne. Il utilise temporairement `.env.deploy` puis supprime ce fichier à la fin :

```bash
cp .env.deploy.example .env.deploy
# Renseigner les trois jetons temporaires
./scripts/deploy-automatic.sh
```

Ne publiez jamais `.env.deploy`. Révoquez les jetons temporaires GitHub et Render après le déploiement.

## Déploiement gratuit

Consultez **[DEPLOIEMENT-GRATUIT.md](./DEPLOIEMENT-GRATUIT.md)**. La formule gratuite recommandée utilise :

- l’adresse `wangala-ia-bf.onrender.com` (sous réserve de disponibilité) ;
- un Web Service Render Free ;
- une clé Groq Free ;
- le modèle `openai/gpt-oss-20b`.

Le fichier `render.yaml` permet à Render de configurer automatiquement le service.

## Production sur VPS

Pour une version sans mise en veille et avec votre propre domaine, consultez **[DEPLOIEMENT.md](./DEPLOIEMENT.md)**. Cette solution utilise Docker Compose et Caddy pour HTTPS.

## Structure utile

```text
frontend/               Interface React + TypeScript
server/server.mjs       API et boucle Agent Mode
Dockerfile.wangala      Image de production
compose.wangala.yml     Déploiement VPS
Caddyfile               HTTPS et reverse proxy
DEPLOIEMENT.md          Guide opératoire
```

## Origine et licence

Le travail a été initialement amorcé à partir du dépôt public [arena-ai/arena](https://github.com/arena-ai/arena), publié sous licence Apache 2.0. Le produit Wangala IA recentre l’expérience sur le chat Agent Mode et remplace l’ancienne interface d’évaluation de modèles. La licence Apache 2.0 d’origine est conservée dans `LICENSE`.
