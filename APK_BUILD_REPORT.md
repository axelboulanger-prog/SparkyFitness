# Rapport de génération APK Android

Date du rapport : 2026-09-05  
Branche : `sante-connect`  
Projet : fork GitHub de `CodeWithCJ/SparkyFitness`  
Package mobile : `SparkyFitnessMobile`

## Résultat actuel

L’APK n’a pas encore été généré dans ce conteneur.

La configuration Expo locale est maintenant lisible et le prébuild Android passe, mais la compilation native release est bloquée par les ressources mémoire du conteneur pendant la compilation C++ de React Native (`react-native-nitro-modules` et `react-native-worklets`). Aucun fichier `.apk` n’a été trouvé dans `SparkyFitnessMobile/android/app/build/outputs/` lors des dernières vérifications.

## Fichiers modifiés ou créés

### Fichiers suivis modifiés

| Fichier | Modification |
|---|---|
| `SparkyFitnessMobile/app.json` | Ajout des permissions Health Connect d’écriture `WRITE_NUTRITION` et `WRITE_HYDRATION`; liaison EAS remplacée par le nouveau projet Expo `@menistil/sparkyfitnessmobile`; ajout de `owner: menistil`; contenu reformatté par Expo. |
| `SparkyFitnessMobile/eas.json` | Profil `production` configuré pour produire un APK Android avec `buildType: apk`; incrément automatique de version activé. |
| `SparkyFitnessMobile/package.json` | Ajout de `"type": "module"` pour permettre au chargeur Expo de lire la configuration JavaScript ESM. |
| `SparkyFitnessMobile/plugins/withAppLanguage.ts` | Suppression de l’import runtime vers le registre TypeScript des locales; locales embarquées déclarées localement (`en`, `pl`, `es`) pour que le plugin soit chargeable par Expo. |
| `SparkyFitnessMobile/plugins/withCalorieWidget.ts` | Même adaptation pour le plugin Android des widgets. |
| `SparkyFitnessMobile/targets/widget/expo-target.config.js` | Référence CommonJS changée de `app.identifiers.js` vers `app.identifiers.cjs`. |
| `pnpm-lock.yaml` | Modifications mécaniques liées aux installations/configurations effectuées pendant les essais. À vérifier avant commit. |

### Fichiers déplacés, générés ou non suivis

| Fichier | État / rôle |
|---|---|
| `SparkyFitnessMobile/app.config.ts` | Source TypeScript initiale déplacée vers `app.config.source.ts` pour empêcher Expo 56 de la découvrir automatiquement avec un mauvais mode de module. |
| `SparkyFitnessMobile/app.config.source.ts` | Copie de la configuration TypeScript originale conservée comme référence source. |
| `SparkyFitnessMobile/app.config.js` | Configuration ESM JavaScript autonome chargée par Expo. Elle reprend la configuration Android/iOS/plugins nécessaire au prébuild. |
| `SparkyFitnessMobile/app.identifiers.js` | Ancien module CommonJS renommé. |
| `SparkyFitnessMobile/app.identifiers.cjs` | Nouvelle version CommonJS utilisée par les targets iOS. |
| `SparkyFitnessMobile/targets/package.json` | Contient `{"type":"commonjs"}` afin de garder les configurations Apple targets compatibles avec `require()`. |
| `SparkyFitnessMobile/android/local.properties` | Fichier local généré pour pointer Gradle vers `/home/codespace/android-sdk`; normalement non versionné. |
| `SparkyFitnessMobile/expo` | Fichier vide non suivi apparu pendant les essais; à supprimer ou examiner avant commit. |
| `package-lock.json` | Lockfile npm non suivi apparu au niveau racine; probablement généré par un outil npm/Expo. À ne pas conserver sans décision explicite. |
| `SparkyFitnessMobile/android/` | Projet natif généré par `expo prebuild --clean`; généralement ignoré et régénérable. |

## Ce qui a été fait

### 1. Diagnostic de l’APK et de Health Connect

- Vérification du code mobile de synchronisation Health Connect.
- Confirmation que la lecture Health Connect et l’écriture vers Health Connect sont deux fonctions séparées.
- Confirmation que les métriques d’écriture sont principalement Nutrition et Hydration.
- Confirmation que l’interface de writeback existe dans le code mais est désactivée par défaut.
- Ajout/maintien des permissions Android :
  - `android.permission.health.WRITE_NUTRITION`
  - `android.permission.health.WRITE_HYDRATION`

### 2. Diagnostic Git et Expo

- Vérification des remotes : le dépôt courant est un fork utilisateur, avec le dépôt original en upstream.
- Branche utilisée : `sante-connect`.
- Ancien projet Expo trouvé dans la configuration :
  - `498a86c5-344f-4d2c-9033-dfd720e4a383`
- Le compte Expo actif était `menistil` / `axel.boulanger@yahoo.fr`.
- L’ancien projet Expo n’était pas accessible à ce compte.
- L’ancien `projectId` a été retiré.
- Nouveau projet Expo créé et lié :
  - `@menistil/sparkyfitnessmobile`
  - project ID : `875b0a47-09be-4d59-b32b-ff62e423251a`

### 3. Essais EAS effectués

Commande utilisée :

```bash
cd SparkyFitnessMobile
npx eas build --platform android --profile production --non-interactive
```

Un premier build a été envoyé à EAS, puis a échoué pendant `READ_APP_CONFIG`.

Le log EAS a révélé :

```text
The `expo` package was not found.
Failed to resolve plugin for module "@kingstinct/react-native-healthkit"
```

Cause : EAS a détecté un workspace npm et a lancé :

```text
npm ci --include=dev
```

à la racine du dépôt, mais le workspace pnpm/monorepo n’a pas installé les dépendances du package mobile. EAS ne disposait donc ni du package `expo`, ni des plugins natifs mobiles.

URL du dernier build EAS observé :

```text
https://expo.dev/accounts/menistil/projects/sparkyfitnessmobile/builds/c7181d1c-1ca1-467b-8fec-8a0e13dab6b6
```

Statut : échec à la lecture de configuration, avant la compilation Android.

### 4. Problèmes de configuration Expo rencontrés

#### Configuration TypeScript/CommonJS/ESM

Le fichier `app.config.ts` utilisait des imports TypeScript/ESM, alors que le package mobile était initialement CommonJS et que le monorepo racine est ESM.

Erreurs rencontrées :

```text
exports is not defined in ES module scope
require is not defined in ES module scope
```

Solution temporaire appliquée :

- génération d’un `app.config.js` ESM autonome;
- déplacement de `app.config.ts` vers `app.config.source.ts`;
- passage du package mobile en `type: module`;
- ajout de `targets/package.json` en CommonJS;
- renommage de `app.identifiers.js` en `app.identifiers.cjs`;
- adaptation de `targets/widget/expo-target.config.js`.

Validation obtenue :

```text
APP_VARIANT=production npx expo config --type public
exit=0
```

La configuration produite indiquait notamment :

```text
name: SparkyFitness
slug: sparkyfitnessmobile
version: 1.6.4
owner: menistil
android package: com.SparkyApps.SparkyFitnessMobile
```

#### Plugin des locales

Les plugins `withAppLanguage.ts` et `withCalorieWidget.ts` importaient le registre TypeScript des locales au moment où Expo charge la configuration.

Cela provoquait :

```text
Cannot read properties of undefined
```

Les plugins utilisent maintenant directement la liste embarquée :

```text
en, pl, es
```

Après cette adaptation :

```text
npx expo prebuild --clean --platform android
```

passe avec succès.

### 5. Problèmes Java/Gradle rencontrés

Premier environnement :

- Java 25
- Gradle 9.3.1

Erreur :

```text
Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field IBM_SEMERU
```

Actions effectuées :

- installation de `openjdk-21-jdk-headless`;
- sélection/utilisation de Java 21;
- remplacement temporaire du wrapper Gradle 9.3.1 par Gradle 8.13.

Gradle 8.13 a supprimé l’erreur `IBM_SEMERU`, mais la compilation locale nécessitait ensuite le SDK Android.

### 6. SDK Android installé

SDK installé dans :

```text
/home/codespace/android-sdk
```

Composants installés :

- Android command-line tools;
- Android Platform 36;
- Android Build Tools 36.0.0;
- Android Platform Tools;
- Android NDK 27.1.12297006;
- CMake 3.22.1, installé automatiquement par Gradle.

Licences Android acceptées avec `sdkmanager`.

Le fichier local suivant a été créé :

```text
SparkyFitnessMobile/android/local.properties
```

avec :

```properties
sdk.dir=/home/codespace/android-sdk
```

### 7. Compilation locale

Commande utilisée :

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/home/codespace/android-sdk
export ANDROID_SDK_ROOT=/home/codespace/android-sdk
export CMAKE_BUILD_PARALLEL_LEVEL=1
cd SparkyFitnessMobile/android
./gradlew assembleRelease --no-daemon --max-workers=1 --console=plain \
  -Dorg.gradle.jvmargs='-Xmx512m -XX:MaxMetaspaceSize=256m -Dfile.encoding=UTF-8'
```

Le build avance jusqu’aux compilations CMake de :

- `react-native-nitro-modules`;
- `react-native-worklets`.

Les essais avec deux workers ont échoué avec :

```text
The message received from the daemon indicates that the daemon has disappeared.
Gradle build daemon disappeared unexpectedly.
```

Cause probable : mémoire insuffisante du conteneur pendant la compilation C++ native. Le dernier essai a été relancé avec un seul worker et `CMAKE_BUILD_PARALLEL_LEVEL=1`; son résultat doit encore être vérifié.

## Résumé des réussites

- Projet Expo original inaccessible identifié.
- Nouveau projet Expo créé sous le compte utilisateur.
- Permissions Health Connect d’écriture présentes dans la configuration.
- Configuration production Expo lisible localement.
- `expo prebuild --clean --platform android` réussi.
- Java 21 installé.
- Gradle 8.13 téléchargé et utilisé.
- SDK Android, Build Tools, NDK et CMake installés.
- Compilation native avancée jusqu’aux modules C++ React Native.

## Résumé des échecs

- `npx eas init` initial : refus d’autorisation sur l’ancien projet Expo.
- Premiers builds EAS : projet Expo inaccessible.
- Builds EAS suivants : dépendances du workspace mobile non installées par `npm ci`; `expo` et `@kingstinct/react-native-healthkit` introuvables.
- Gradle 9.3.1 avec Java 25 : incompatibilité `IBM_SEMERU`.
- Gradle local initial : SDK Android absent.
- Compilation locale avec deux workers : daemon Gradle tué pendant CMake.
- Aucun APK produit dans les sorties vérifiées.

## Ce qui reste à faire

### Priorité 1 : terminer la compilation locale

1. Vérifier le résultat du dernier processus Gradle.
2. Si le daemon est encore tué, utiliser une machine avec davantage de mémoire ou augmenter les ressources du dev container.
3. Relancer la même commande une fois les ressources disponibles.
4. Vérifier le fichier attendu :

```text
SparkyFitnessMobile/android/app/build/outputs/apk/release/app-release.apk
```

5. Vérifier le contenu de l’APK et les permissions Health Connect avec `apkanalyzer` ou `aapt dump permissions`.

### Priorité 2 : nettoyer la configuration avant commit

Avant de committer, décider explicitement de conserver ou non :

- `app.config.js`;
- `app.config.source.ts`;
- `app.identifiers.cjs`;
- `targets/package.json`;
- les modifications de `package.json`;
- les modifications de plugins;
- `pnpm-lock.yaml`;
- `package-lock.json`;
- le fichier vide `SparkyFitnessMobile/expo`.

Le fichier `android/local.properties` ne doit normalement pas être committé : il contient un chemin local propre au conteneur.

### Priorité 3 : corriger proprement le build EAS

Le build EAS devrait être configuré pour installer le monorepo avec pnpm depuis la racine, ou recevoir un package mobile autonome avec toutes ses dépendances et un lockfile cohérent.

Tant que EAS utilise `npm ci` dans la mauvaise racine, le cloud échouera avant la compilation native.

## Attention importante

La valeur `0000000000` utilisée comme Apple Team ID est un placeholder pour permettre la lecture de configuration Android. Elle n’est pas valable pour un build iOS réel et devra être remplacée par le vrai Apple Team ID.

Ce rapport décrit les opérations de génération et de diagnostic effectuées. Il ne remplace pas une validation finale de l’APK sur un appareil Android réel, notamment pour vérifier l’apparition des permissions Health Connect d’écriture et l’interface de writeback Nutrition/Hydration.
