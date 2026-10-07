# Pilotage — Ouverture des centres de prélèvement (CHR Verviers)

Application web statique (HTML/CSS/JS), sans base de données ni serveur applicatif.
4 fichiers à héberger ensemble :

```
index.html   → structure de la page
style.css    → mise en forme (couleurs, typographie, mise en page)
app.js       → logique (calculs de dates, rendu, interactions)
data.json    → les données métier (centres, tâches, commandes) — le seul fichier
               que vous modifierez régulièrement
```

## 1. Déployer sur votre hébergement

N'importe quel hébergement web statique convient (mutualisé/FTP, cPanel, IIS,
Apache, Nginx, Netlify, Vercel, GitHub Pages…). Il n'y a **aucun backend, base de
données ou dépendance à installer**.

**Hébergement mutualisé classique (FTP / cPanel / File Manager) :**
1. Connectez-vous à votre espace (FTP, SFTP, ou gestionnaire de fichiers du panneau
   d'administration).
2. Créez un dossier, par exemple `pilotage-centres/`.
3. Déposez-y les 4 fichiers (`index.html`, `style.css`, `app.js`, `data.json`)
   **au même niveau**, sans les mettre dans des sous-dossiers.
4. Ouvrez `https://votre-domaine/pilotage-centres/` dans un navigateur.

**Important :** ouvrir `index.html` en double-cliquant dessus (mode `file://`) ne
fonctionne pas — le navigateur bloque le chargement de `data.json` pour des
raisons de sécurité. Le site doit être servi via `http://` ou `https://`
(n'importe quel hébergement web fait cela automatiquement).

**Netlify / Vercel (glisser-déposer) :** faites glisser le dossier entier sur la
page de déploiement du service — aucune configuration nécessaire, ce sont des
fichiers statiques.

## 2. Modifier les données (ajouter/déplacer un centre, changer une date…)

Tout le contenu métier vit dans `data.json`. Vous pouvez l'éditer avec
n'importe quel éditeur de texte (Bloc-notes, VS Code, etc.) puis le redéposer
sur l'hébergement — aucune connaissance en programmation n'est nécessaire, il
suffit de respecter la structure.

Structure d'un centre :

```json
{
  "id": "c7",
  "nom": "7. Nom du centre",
  "type": "V-Pharma (nouveau box)",
  "priorite": 7,
  "kickoff": "2027-03-01",
  "ouverture": "2027-05-03",
  "budget": "complet",
  "urgence": "Texte libre affiché dans l'encart d'alerte de la carte.",
  "tasks": [
    {
      "id": "t99",
      "phase": "Cadrage administratif",
      "label": "Description de la tâche",
      "resp": "Nom du responsable",
      "start": "2027-03-01",
      "end": "2027-03-15",
      "status": "todo",
      "milestone": false
    }
  ],
  "orders": [
    {
      "id": "7-o1",
      "poste": "Fauteuil de prélèvement",
      "pu": 2535.0,
      "qty": 1,
      "info": "Fournisseur / référence",
      "status": "a_commander",
      "leadtime": 8
    }
  ]
}
```

Règles à respecter :
- Les dates sont au format `AAAA-MM-JJ`.
- `status` d'une tâche : `"blocked"`, `"todo"`, `"doing"` ou `"done"`.
- `status` d'une commande : `"a_commander"`, `"commande"`, `"livre"` ou `"na"`.
- `milestone: true` sur une seule tâche par centre (l'ouverture) — elle est
  affichée différemment (jalon violet).
- `leadtime` : nombre de semaines de délai fournisseur si pertinent, sinon
  `null` — fait apparaître le badge d'alerte orange dans l'onglet Commandes.
- Chaque `id` (centre, tâche, commande) doit être unique dans tout le fichier.
- `reporting_deadline` et `today` en haut du fichier pilotent la bannière
  d'échéance et le calcul « aujourd'hui » / « jours restants ». **Pensez à
  mettre `today` à jour** (ou à le calculer dynamiquement — voir plus bas) sinon
  les compteurs resteront figés à la date de création du fichier.

## 3. Date du jour

`app.js` calcule déjà la date du jour dynamiquement (`new Date()`) — les
compteurs « J-XX avant ouverture » restent donc corrects sans aucune
intervention de votre part. Le champ `"today"` dans `data.json` n'est utilisé
que comme repère interne et peut être ignoré.

## 4. Personnaliser l'apparence ou les libellés

- Couleurs, espacements, typographie : tout est dans `style.css`, regroupé en
  variables en haut du fichier (`:root { --navy: ...; --teal: ...; }`).
- Libellés des statuts, seuils d'alerte (jours avant retard), URL du fichier de
  données : tout est regroupé dans l'objet `CONFIG` en haut de `app.js`.
- Le logo CHR Verviers ou une image d'en-tête peuvent être ajoutés dans le
  bandeau `.topbar` de `index.html`.

## 5. Partage des données entre utilisateurs

L'outil détecte automatiquement son environnement :
- **Dans Claude** (artefact) : les statuts modifiés sont sauvegardés via le
  stockage partagé de Claude — toute l'équipe voit les mêmes mises à jour en
  temps réel.
- **Une fois déployé sur votre hébergement** : ce mécanisme n'existe plus (il
  est propre à Claude), donc l'application bascule automatiquement sur le
  stockage local du navigateur (`localStorage`). **Cela veut dire que les
  statuts cochés par une personne restent sur son ordinateur/navigateur et ne
  sont pas visibles par les autres.** Le pied de page de l'application indique
  quel mode est actif.

Deux options pour un pilotage réellement collaboratif une fois hébergé chez
vous, du plus simple au plus robuste :
- **Le plus simple** : gardez `data.json` comme unique source de vérité et
  éditez-le à la main (statuts, dates) au fil de l'eau, en le redéposant sur
  l'hébergement — convient à une mise à jour hebdomadaire par une seule
  personne (ex. Jérémy Counet).
- **Le plus robuste (recommandé, déjà intégré)** : l'onglet **Édition** de
  l'application permet de modifier chaque paramètre (dates, priorités,
  budget, tâches, articles à commander) directement dans le navigateur, et
  de les publier pour toute l'équipe en un clic. Voir section 6 ci-dessous
  pour l'activer.

## 6. Activer l'édition partagée (onglet « Édition »)

L'onglet **Édition** fonctionne dans les deux cas, mais avec des garanties
différentes :

- **Sans configuration** : les modifications s'appliquent immédiatement dans
  votre navigateur (vous voyez le résultat tout de suite dans les autres
  onglets), mais elles ne sont **pas partagées** avec vos collègues et sont
  **perdues si vous fermez l'onglet sans publier**. Le bouton
  « ⇩ Télécharger une copie (JSON) » permet de sauvegarder votre travail à
  tout moment — remplacez alors le fichier `data.json` sur votre hébergement
  par cette copie.
- **Avec Vercel Blob configuré** (déploiement sur Vercel uniquement) : le
  bouton « ⇪ Publier pour toute l'équipe » écrit les données dans un stockage
  partagé, immédiatement visible par tout le monde. Trois étapes, une seule
  fois, dans le dashboard Vercel du projet :
  1. **Storage** → **Create Database** → **Blob** → **Connect to Project**.
     Cela ajoute automatiquement la variable d'environnement
     `BLOB_READ_WRITE_TOKEN`.
  2. *(Recommandé)* **Settings** → **Environment Variables** → ajoutez
     `EDIT_PASSWORD` avec un mot de passe de votre choix, pour empêcher
     quiconque connaissant l'URL du site de modifier les données. Sans cette
     variable, la publication est ouverte à tous.
  3. Redéployez le projet (un nouveau déploiement suffit à prendre en compte
     les variables d'environnement).

  Une fois ces étapes faites, dites-le-moi : je peux relancer un déploiement
  pour vous depuis cette conversation.

Ce mécanisme (`/api/data`) est un fichier `api/data.js` inclus dans ce
paquet — il ne fonctionne que sur un hébergement qui exécute du code
serveur (Vercel, Netlify Functions, etc.), pas sur un hébergement mutualisé
classique en FTP pur. Sur ce type d'hébergement, seule l'édition locale +
téléchargement de copie est disponible.


## Enregistrement automatique et modifications pour tous les centres (v8)
- Chaque modification dans l'onglet Édition est enregistrée automatiquement (~1 s) et partagée avec l'équipe (si le stockage partagé est actif).
- Case « Appliquer à tous les centres » : article/tâche modifié, ajouté ou supprimé = répercuté sur tous les centres. Statuts et quantités restent propres à chaque centre. Les dates ne sont répercutées que si la 2e case est cochée.
