# relay : périmètre du MVP

relay est un multiplexeur de terminal pensé comme un tiling window manager, pour lancer et suivre des agents de code (Claude Code, pi). Il remplace herdr.

- **Socle technique** : celui de herdr (Rust, Apache 2.0), repris dans un nouveau repo et non forké : PTY, serveur persistant, détection d'état des agents, CLI et socket.
- **Concepts et raccourcis** : ceux d'Illium.
- **Apparence** : inspirée de tuios (fenêtres, animations, palette Ctrl+P).

## Vocabulaire

| relay | Illium | herdr |
|---|---|---|
| Space | Space | Workspace |
| Workspace (1…9) | Workspace | Tab |
| Window | Window | Pane |

## MVP

### Socle technique

- Serveur persistant et client : un client se détache et se rattache, les processus continuent de tourner.
- PTY et émulation de terminal avec alacritty_terminal (crate Rust pur, pas de Zig à installer).
- Restauration après un redémarrage du serveur ou de la machine : spaces, workspaces, fenêtres et leur cwd. Les sessions Claude Code et pi reprennent (`--resume`).
- Détection d'état des agents (working, blocked, done, idle) pour Claude Code et pi : processus au premier plan, manifestes d'écran et hooks d'intégration repris de herdr.
- CLI et socket API minimaux pour piloter relay depuis un script (créer ou focus un space, lancer une commande dans une fenêtre, lister l'état). Pas de compatibilité avec l'API herdr.

### Modèle TWM

- **Spaces** : un par projet. Création depuis la palette (sessionizer sur `~/dev` et `~/dev/peren`), qui donne le focus au space s'il existe déjà. Renommer, supprimer.
- **Workspaces 1…9** dans chaque space. Workspace occupé suivant, workspace récent, déplacer la fenêtre vers un workspace et la suivre. Chaque space retient son workspace actif et son workspace récent.
- **Windows** en tiling fibonacci automatique, comme Illium : la première prend la moitié gauche, les suivantes partagent le reste en alternant horizontal et vertical. Pas de split manuel.
- Focus géométrique (voisin le plus proche dans la direction), swap directionnel, resize par pas de 5 %, plein écran réversible, fermeture.
- Fenêtres flottantes : bascule float/tiling ; une fenêtre qui flotte pour la première fois est centrée. Popups flottantes lancées par commande (terminal, git log, lazygit) qui se ferment quand la commande se termine.

### Clavier

- Modificateur principal configurable : `ctrl` (par défaut), `alt` ou `meta`.
- Raccourcis directs, réduits au minimum pour ne pas entrer en conflit avec le shell :

| Touche | Action |
|---|---|
| Mod+H/J/K/L | Focus gauche/bas/haut/droite |
| Mod+1…9 | Workspace 1…9 |
| Mod+P | Palette |

- Leader **Ctrl+B**, puis une touche, avec un menu which-key :
  - pas de délai d'expiration ;
  - Échap annule, Retour arrière revient à la racine ;
  - une touche inconnue est ignorée sans fermer le menu ;
  - Ctrl+B Ctrl+B envoie un vrai Ctrl+B à la fenêtre ;
  - les touches de resize laissent le menu ouvert pour pouvoir les répéter.

| Après Ctrl+B | Action |
|---|---|
| Enter | Nouveau terminal |
| q | Fermer la fenêtre |
| f | Plein écran |
| t | Basculer float/tiling |
| H/J/K/L | Swap directionnel |
| u / p | Largeur −5 % / +5 % |
| i / o | Hauteur −5 % / +5 % |
| s / d | Workspace occupé suivant / workspace récent |
| m puis 1…9 | Déplacer vers le workspace et suivre |
| S | Space picker |
| ? | Liste des raccourcis |
| x | Sous-menu système : `d` détacher, `r` recharger la config, `q` arrêter le serveur |

- `keybindings.toml` au format d'Illium (`"Ctrl+H" = "window focus left"`), rechargé à chaud.

### Souris

- Clic sur une fenêtre pour lui donner le focus, clic sur un workspace dans la barre pour y aller.
- Drag d'une fenêtre tilée sur une autre pour les échanger. Drag des bordures entre fenêtres pour redimensionner. Drag des fenêtres flottantes pour les déplacer et les redimensionner.
- Clic droit : menu contextuel sur une fenêtre et sur un workspace de la barre.
- Molette pour remonter le scrollback sans changer de mode ; taper du texte revient en bas.
- Sélection au drag, double clic (mot), triple clic (ligne), copie OSC 52 au relâchement.

### Apparence

- Fenêtres à bordure arrondie, titre dans la bordure du haut, badge d'état de l'agent, boutons cliquables (fermer, zoom, float).
- Barre d'état type Illium : workspaces occupés et actif à gauche (cliquables), date et heure au centre, zone agents à droite (contenu à définir).
- Palette unique (Mod+P) avec recherche fuzzy :
  - actions ;
  - fenêtres de tous les spaces ;
  - spaces ;
  - programmes à lancer (alias configurables comme claude, pi, lazygit) ;
  - projets du sessionizer.

  Le préfixe `@état` filtre les fenêtres par état d'agent, par exemple `@b` pour blocked.
- Space picker : liste des spaces avec l'état de leurs agents. `N` pour créer, `E` pour renommer, `D` `D` pour supprimer.
- Animations : slide des fenêtres au retiling, fondu des overlays, zoom animé, shimmer sur les fenêtres où un agent travaille. Réglage `motion = "none" | "basic" | "full"`. Aucun rendu tant que rien ne bouge.

## Plus tard

- Contenu détaillé de la partie droite de la barre (agents qui travaillent, qui attendent une réponse…)
- Copy mode clavier (hjkl, recherche, sélection)
- Notifications quand un agent bloque ou termine
- Thèmes, synchronisés avec le thème dynamique d'Illium
- Éditeur de raccourcis et paramètres dans l'application
- Workspace switcher avec miniatures
- Plusieurs clients attachés sur des workspaces différents
- Mise à jour du binaire sans tuer les processus (live handoff)
- Autres agents (Codex, OpenCode…)
- Effets bonus (confettis quand un agent termine)

## Hors scope

- Remote/SSH et multi-machines
- Plugins
- Worktrees intégrés
- Support Windows natif (relay tourne dans WSL)
- Mise à jour automatique
- Images kitty et sixel
- Layout mobile
- Compatibilité avec l'API herdr
- Sidebar
- Splits manuels et autres layouts (master-stack, scrolling)
