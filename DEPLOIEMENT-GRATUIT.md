# Déploiement gratuit de Wangala IA

## Combinaison retenue

| Besoin | Service gratuit | Configuration |
|---|---|---|
| Adresse web | Sous-domaine Render | `wangala-ia-bf.onrender.com` si le nom est disponible |
| Hébergement | Render Free Web Service | Docker, HTTPS et déploiement Git inclus |
| Modèle IA | Groq Free | `llama-3.3-70b-versatile` via l’API compatible OpenAI |

Cette solution ne nécessite ni VPS, ni base de données, ni domaine payant. L’historique reste dans le navigateur de chaque utilisateur.

## Étape 1 — Mettre le projet sur GitHub

1. Créez gratuitement un compte sur <https://github.com/>.
2. Créez un dépôt nommé `wangala-ia`.
3. Envoyez le contenu du projet dans ce dépôt.

Exemple depuis le dossier du projet :

```bash
git init
git add .
git commit -m "Première version de Wangala IA"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/wangala-ia.git
git push -u origin main
```

## Étape 2 — Obtenir gratuitement une clé Groq

1. Ouvrez <https://console.groq.com/>.
2. Créez un compte gratuit.
3. Ouvrez la rubrique **API Keys**.
4. Créez une clé et copiez-la.

Ne placez jamais cette clé dans GitHub ou dans le frontend.

## Étape 3 — Déployer gratuitement sur Render

1. Créez un compte sur <https://render.com/>.
2. Dans le tableau de bord, choisissez **New → Blueprint**.
3. Connectez le dépôt GitHub `wangala-ia`.
4. Render détectera automatiquement le fichier `render.yaml`.
5. Lorsque Render demande `LLM_API_KEY`, collez la clé Groq.
6. Validez avec le plan **Free**.

Le déploiement compile automatiquement l’interface et démarre l’API. Une adresse similaire à celle-ci sera attribuée :

```text
https://wangala-ia-bf.onrender.com
```

Si ce nom est déjà occupé, Render ajoutera ou demandera un suffixe.

## Vérification

Ouvrez :

```text
https://VOTRE-ADRESSE.onrender.com/api/health
```

La réponse doit contenir :

```json
{
  "status": "ok",
  "service": "wangala-ia",
  "modelConfigured": true
}
```

Testez ensuite un message depuis la page principale.

## Limites du tout-gratuit

- Render met le service en veille après environ 15 minutes sans visite. La première ouverture suivante peut prendre jusqu’à environ une minute.
- Render accorde 750 heures gratuites par mois à l’espace de travail ; cela couvre normalement un service unique.
- Les quotas Groq gratuits varient selon le modèle et le compte. Pour `llama-3.3-70b-versatile`, la limite de référence est de 30 requêtes par minute et 1 000 par jour, mais la limite de jetons peut être atteinte avant.
- L’adresse `.onrender.com` est gratuite, mais ce n’est pas un véritable domaine `.bf`.
- Cette formule convient à un prototype et à des essais publics modérés, pas à un service critique.

## Alternative gratuite si Groq refuse l’inscription

Google AI Studio et l’API Gemini sont officiellement disponibles au Burkina Faso. Dans Render, remplacez les variables par :

```dotenv
LLM_API_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3-flash-preview
LLM_API_KEY=votre-cle-gemini
```

Créez la clé sur <https://aistudio.google.com/>. La disponibilité et les quotas gratuits dépendent du modèle. Sur le niveau gratuit, certaines données peuvent être utilisées par Google pour améliorer ses produits : évitez donc les documents confidentiels.

## Plus tard : domaine professionnel

Un domaine réel comme `wangalaia.com` ou `wangala.bf` sera payant. Il pourra être relié au même service Render sans modifier l’application. Render fournit alors aussi le certificat HTTPS.
