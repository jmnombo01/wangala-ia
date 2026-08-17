# Wangala IA — interface web

Interface française du chat **Wangala Agent**, avec une identité visuelle inspirée du Burkina Faso.

## Développement

```bash
npm install
npm run dev
```

Sans `VITE_CHAT_API_URL`, l’interface utilise des réponses de démonstration locales. Pour connecter le serveur :

```bash
cp .env.example .env
# VITE_CHAT_API_URL=http://localhost:8787
npm run dev
```

## Production

Le `Dockerfile.wangala` à la racine compile l’interface et la sert avec l’API Node. Consultez `DEPLOIEMENT.md`.
