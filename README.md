# Atelier BD — Générateur de planches

Application web one-page (`index.html`) pour générer les planches d'une BD via l'API OpenAI
(modèles `gpt-image-1` et suivants), avec continuité des personnages et des décors.

Tout tourne dans le navigateur (aucun serveur à gérer, aucune base de données à héberger) :
- les personnages, lieux, pages et journaux sont stockés dans **IndexedDB**, localement ;
- une **Cloudflare Pages Function** (`functions/api/generate.js`) sert uniquement de relais
  vers l'API OpenAI, pour que ta clé API ne soit jamais visible dans le navigateur.

## 1. Déploiement sur Cloudflare Pages

1. Pousse ce dossier tel quel sur un repo GitHub/GitLab (ou utilise `wrangler pages deploy .`
   directement si tu préfères la CLI).
2. Dans Cloudflare : **Workers & Pages → Créer → Pages → Connecter un dépôt**, sélectionne ce repo.
   - Build command : *(aucune — laisse vide)*
   - Dossier de sortie (« Build output directory ») : `/` (racine)
3. Une fois le projet créé : **Settings → Environment variables**, ajoute :
   - `OPENAI_API_KEY` = ta clé API OpenAI (à renseigner pour **Production** et **Preview**)
4. Redéploie (ou attends le déploiement initial). L'app est en ligne, et `/api/generate`
   fonctionne automatiquement — Cloudflare détecte le dossier `functions/` tout seul.

C'est tout : pas de build, pas de dépendances à installer, pas de backend séparé à héberger.

**Sécurité** : le déploiement produit une URL publique. Pour un usage strictement personnel,
protège-la avec **Cloudflare Access** (Zero Trust → Access → Applications) si tu ne veux pas
qu'elle soit utilisable par n'importe qui qui tomberait sur le lien.

## 2. Utilisation

L'app comporte 5 onglets, dans l'ordre où tu les remplis normalement :

1. **Kit & réglages** — le kit de génération (JSON) et les paramètres par défaut (modèle,
   taille, qualité, nombre de générations simultanées).
2. **Personnages** — téléverse les images une fois ; elles restent en mémoire dans le
   navigateur et sont automatiquement jointes à chaque page qui les référence.
3. **Lieux** *(optionnel)* — fiches de décor (texte + image de référence facultative).
4. **Pages** — importe le scénario (JSON ou Excel/CSV).
5. **Génération** — mode simulation (aucun appel API, juste un aperçu), génération réelle
   avec reprise automatique, relance des échecs, et téléchargement des images (une par une
   ou en `.zip`).

Rien n'est envoyé à l'API tant que tu n'as pas cliqué sur « Lancer / reprendre » ou
« Tout régénérer ».

## 3. Format du kit de génération (JSON)

C'est la partie **commune à toutes les pages** : style graphique, format, règles, ce qu'il
faut éviter. Fichier d'exemple : `examples/kit.example.json`.

```json
{
  "style": "Description du style graphique (traits, couleurs, ambiance).",
  "format": "Format des planches (ex: webtoon vertical, planche BD classique).",
  "size": "1024x1536",
  "quality": "high",
  "rules": [
    "Règle de composition ou de continuité 1",
    "Règle de composition ou de continuité 2"
  ],
  "negative_prompt": "flou, watermark, texte incrusté, mains déformées",
  "continuity_notes": "Notes libres sur ce qui doit rester cohérent d'une page à l'autre."
}
```

Tous les champs sont facultatifs, sauf qu'un kit vide donnera de moins bons résultats.
`size` et `quality`, s'ils sont présents dans le kit, **remplacent** les réglages par défaut
de l'onglet 1 pour toutes les pages (utile si cette BD a un format particulier).
Tu peux ajouter n'importe quel autre champ (ex. `palette`, `lettrage`) : il sera repris tel
quel dans le prompt envoyé au modèle.

## 4. Format des pages

### Option A — JSON (tableau d'objets)

Fichier d'exemple : `examples/pages.example.json`.

```json
[
  {
    "id": "page_001",
    "characters": ["camille", "noa"],
    "location": "appartement_salon",
    "context": "Il pleut, 18h30, ambiance tendue.",
    "prompt": "Camille est assise sur le canapé, Noa se tient debout près de la fenêtre."
  }
]
```

| Champ        | Obligatoire | Description                                                              |
|--------------|:-----------:|---------------------------------------------------------------------------|
| `id`         | non         | Identifiant unique (sinon généré : `page_001`, `page_002`…). Sert aussi de nom de fichier à l'export. |
| `characters` | non         | Liste des personnages présents (doivent correspondre aux noms donnés à l'étape « Personnages », insensible à la casse/accents). |
| `location`   | non         | Clé d'une fiche de lieu (onglet « Lieux »).                               |
| `context`    | non         | État de la scène : météo, heure, position des personnages, objets tenus, ce qui vient de se passer. C'est ce qui remplace la mémoire de conversation. |
| `prompt`     | **oui**     | Action / cadrage / dialogue propre à cette page.                         |

### Option B — Excel / CSV

Une feuille avec les colonnes `id | characters | location | context | prompt`
(personnages séparés par des virgules dans la cellule). Les en-têtes en français
(`personnages`, `lieu`, `contexte`, `instructions`) sont aussi reconnus.

### Réimporter un fichier

Réimporter met à jour le contenu des pages existantes (même `id`) sans toucher à leur statut
déjà généré — pratique pour corriger un prompt sans perdre les pages déjà prêtes.

## 5. Comment la continuité est assurée

Chaque appel API est indépendant (surtout en parallèle), donc chaque page reçoit
explicitement, dans l'ordre :

```
[KIT DE GÉNÉRATION]        ← identique sur toutes les pages
[LIEU: ...]                 ← si un lieu est renseigné
[CONTEXTE DE LA SCÈNE]      ← état de l'histoire au début de cette page
[PERSONNAGES PRÉSENTS]      ← liste des noms
[INSTRUCTIONS DE LA PAGE]   ← le prompt spécifique
```

+ les images de référence des personnages (et du lieu, si une image lui a été associée),
envoyées à l'API `images/edits`. Une page sans aucune image de référence bascule
automatiquement sur `images/generations` (génération pure, utile pour un plan d'ambiance
sans personnage).

## 6. Concurrence, reprise, journal d'erreurs

- **Générations simultanées** (onglet 1) : limite le nombre d'appels API en parallèle
  (2–3 est un bon réglage pour maîtriser le débit et les coûts).
- **Lancer / reprendre** : ne traite que les pages qui ne sont pas déjà « Prête ».
- **Relancer les échecs** : ne retraite que les pages en erreur.
- **Tout régénérer** : force la régénération de toutes les pages (demande confirmation —
  cela consomme à nouveau des crédits).
- Le journal (bas de l'onglet 5) garde une trace de chaque action et de chaque erreur ;
  les 500 dernières lignes sont conservées d'une session à l'autre.

## 7. Coûts

L'app n'a aucun quota gratuit intégré : chaque page traitée en dehors du mode simulation
appelle réellement l'API OpenAI et sera facturée selon ton compte. Utilise le mode
simulation pour valider tout le pipeline (kit, personnages, lieux, prompts) avant de lancer
une génération réelle, et commence par 2–3 pages avant de lancer toute la BD.
