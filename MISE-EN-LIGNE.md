# Mise en ligne de Wangala IA — GitHub + Groq + Render

## 1. Créer le dépôt GitHub

Sur <https://github.com/new> :

- **Repository name** : `wangala-ia`
- **Visibility** : `Public` (plus simple pour le prototype)
- ne cochez pas « Add a README » ;
- cliquez sur **Create repository**.

### Envoyer le projet avec Git

Téléchargez et décompressez `Wangala-IA-source.zip`, ouvrez un terminal dans le dossier obtenu, puis exécutez :

```bash
git init -b main
git add .
git commit -m "Première version de Wangala IA"
git remote add origin https://github.com/VOTRE_IDENTIFIANT/wangala-ia.git
git push -u origin main
```

Remplacez `VOTRE_IDENTIFIANT` par votre nom d’utilisateur GitHub.

### Sans ligne de commande

Dans le dépôt GitHub vide :

1. cliquez sur **uploading an existing file** ;
2. faites glisser le contenu du dossier décompressé ;
3. saisissez `Première version de Wangala IA` ;
4. cliquez sur **Commit changes**.

Vérifiez que `render.yaml`, `Dockerfile.wangala`, `frontend` et `server` apparaissent à la racine du dépôt.

## 2. Créer la clé Groq gratuite

1. Ouvrez <https://console.groq.com/>.
2. Créez votre compte gratuit.
3. Ouvrez **API Keys**.
4. Cliquez sur **Create API Key**.
5. Copiez la clé dans un endroit sûr.

Important : ne mettez jamais cette clé dans GitHub et ne l’envoyez pas dans une discussion.

## 3. Connecter GitHub à Render

Dans <https://dashboard.render.com/> :

1. cliquez sur **New** ;
2. choisissez **Blueprint** ;
3. connectez GitHub si nécessaire ;
4. sélectionnez le dépôt `wangala-ia` ;
5. Render détectera `render.yaml` ;
6. pour la variable secrète `LLM_API_KEY`, collez la clé Groq ;
7. vérifiez que le plan indiqué est **Free** ;
8. lancez le déploiement.

Les autres réglages sont déjà préparés :

```text
LLM_API_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-20b
RATE_LIMIT_PER_MINUTE=20
```

## 4. Vérifier le résultat

Lorsque Render affiche **Live**, ouvrez l’adresse attribuée, par exemple :

```text
https://wangala-ia-bf.onrender.com
```

Vérifiez également :

```text
https://VOTRE-ADRESSE.onrender.com/api/health
```

La valeur `modelConfigured` doit être `true`.

## En cas d’échec du Blueprint

Créez un **Web Service** manuellement :

- Runtime : `Docker`
- Branch : `main`
- Dockerfile Path : `./Dockerfile.wangala`
- Plan : `Free`
- Health Check Path : `/api/health`

Ajoutez ensuite les trois variables `LLM_API_URL`, `LLM_MODEL` et `LLM_API_KEY` listées ci-dessus.
