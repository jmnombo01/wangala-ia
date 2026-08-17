export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type AgentTrace = {
  label: string
  detail?: string
}

export type AgentResponse = {
  content: string
  trace?: AgentTrace[]
}

const API_URL = (import.meta.env.VITE_CHAT_API_URL || '').replace(/\/$/, '')
export const isDemoMode = import.meta.env.VITE_DEMO_MODE !== 'false'

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

function demoResponse(prompt: string): AgentResponse {
  const normalized = prompt.toLocaleLowerCase('fr')

  if (normalized.includes('entreprise') || normalized.includes('commerce')) {
    return {
      content:
        "Voici une base claire pour lancer votre projet :\n\n1. **Définir le besoin local** — identifiez précisément les clients, leur pouvoir d’achat et le problème résolu.\n2. **Tester à petite échelle** — proposez une première offre simple à 10–20 clients et recueillez leurs retours.\n3. **Calculer les coûts** — séparez investissement initial, charges mensuelles et marge par vente.\n4. **Choisir les bons canaux** — WhatsApp Business, recommandations locales et présence terrain sont souvent complémentaires.\n5. **Mesurer chaque semaine** — ventes, dépenses, demandes reçues et satisfaction.\n\nSi vous me donnez le secteur, la ville et votre budget, je peux préparer un plan d’action sur 30 jours.",
      trace: [
        { label: 'Demande analysée', detail: 'Projet entrepreneurial' },
        { label: 'Plan structuré', detail: '5 étapes actionnables' },
      ],
    }
  }

  if (normalized.includes('lettre') || normalized.includes('courrier')) {
    return {
      content:
        "Je peux rédiger la lettre en français formel. Indiquez-moi simplement :\n\n- le destinataire et sa fonction ;\n- l’objet de la demande ;\n- les faits ou dates importants ;\n- le résultat souhaité ;\n- vos nom, fonction et coordonnées.\n\nJe vous rendrai une version prête à copier, avec l’objet, la formule d’appel et la formule de politesse adaptées.",
      trace: [{ label: 'Format identifié', detail: 'Courrier administratif' }],
    }
  }

  if (normalized.includes('document') || normalized.includes('résum')) {
    return {
      content:
        "Je peux analyser votre document et produire au choix : un résumé court, une synthèse structurée, les points clés, un tableau d’actions ou une reformulation en français simple.\n\nAjoutez un fichier texte avec le bouton trombone, puis précisez le format et la longueur souhaités.",
      trace: [{ label: 'Besoin identifié', detail: 'Analyse documentaire' }],
    }
  }

  return {
    content:
      "Je suis prêt à vous aider. Pour obtenir un résultat précis, ajoutez si possible le contexte, votre objectif, les contraintes et le format attendu.\n\n*Cette prévisualisation utilise le mode démonstration. Le branchement à un modèle d’IA sera activé au déploiement avec votre clé API.*",
    trace: [
      { label: 'Intention comprise' },
      { label: 'Réponse préparée', detail: 'Mode démonstration' },
    ],
  }
}

export async function sendToAgent(messages: ChatMessage[]): Promise<AgentResponse> {
  if (isDemoMode) {
    await wait(1150)
    return demoResponse(messages[messages.length - 1]?.content ?? '')
  }

  const response = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || 'Le service IA est momentanément indisponible.')
  }

  return response.json()
}

