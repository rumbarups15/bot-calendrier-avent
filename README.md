# Bot Calendrier de l'Avent

Bot Discord de calendrier de l'Avent. Il permet de configurer un calendrier et ses récompenses, de lancer ou arrêter l'événement, et de programmer une clôture automatique.
## Fonctionnalités
- Panel de configuration du calendrier
- Panel de configuration des récompenses, jour par jour
- Lancement de l'événement, avec publication des récompenses (
- Arrêt de l'événement et désactivation du calendrier
- Clôture automatique à une date et une heure précises
- Affichage de la latence du bot
- Liste des commandes
Les commandes sont réservées à un propriétaire défini par la variable `OWNER_ID`. Si cette variable est vide, les commandes sont accessibles à tous.
## Prérequis
- [Node.js](https://nodejs.org) version 22.12.0 ou supérieure
- Une application Discord créée sur le [Discord Developer Portal](https://discord.com/developers/applications)
## Installation
1. Clone le dépôt :
   ```bash
   git clone https://github.com/inesakalove76-droid/bot-calendrier-avent.git
   cd bot-calendrier-avent
   ```
2. Installe les dépendances et lancer le bot :
   ```bash
   npm install
   npm start
   ```
## Structure du projet
```
bot-calendrier-avent/
├── index.js
├── package.json
├── .env
├── commands/
│   ├── calendrier.js
│   ├── cloture.js
│   ├── evenement.js
│   ├── help.js
│   ├── ping.js
│   ├── rewardconfig.js
│   └── stop.js
```
## Configuration
Pour que le bot fonctionne correctement sur ton serveur :
1. Invite le bot avec les permissions nécessaires à l'envoi de messages et à la gestion des salons.
2. Utilise `/calendrier` pour choisir le salon où le calendrier sera publié.
3. Utilise `/rewardconfig` pour définir la récompense de chaque jour.
4. Utilise `/evenement` pour lancer le calendrier.
