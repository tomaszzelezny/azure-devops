# Aging WIP dla Azure DevOps

Rozszerzenie Azure DevOps z wykresem **Aging WIP** (slajd 1.f z prezentacji „Azure DevOps + AI do analizy danych”).

Każda kropka to otwarty element w toku:

- **oś X**: wiek elementu, czyli dni od utworzenia (`System.CreatedDate`),
- **oś Y**: dni w obecnym stanie (`Microsoft.VSTS.Common.StateChangeDate`),
- **przerywana przekątna**: elementy, które nie zmieniły stanu od utworzenia,
- **czerwona linia**: próg „N dni w tym samym stanie” (domyślnie rok; do wyboru 30 dni, 90 dni, pół roku, rok, 2 lata),
- kolor kropki to stan; najechanie pokazuje szczegóły, kliknięcie otwiera work item.

Pod wykresem jest podsumowanie w stylu prezentacji („27 z 140 elementów stoi w tym samym stanie ponad rok. Tylko 50 elementów zmieniło stan w ostatnich 30 dniach.”).

## Co zawiera rozszerzenie

| Element | Gdzie | Opis |
|---|---|---|
| Hub **Aging WIP** | Boards → Aging WIP | Wybór zespołu, typów, stanów i progu; legenda z liczbami (klik ukrywa stan); tabela 50 elementów najdłużej stojących w obecnym stanie. Ustawienia zapamiętywane w przeglądarce per projekt. |
| Widget **Aging WIP** | Dashboard → Add widget | Rozmiary od 2×2 do 6×4. Konfiguracja: zespół (domyślnie zespół dashboardu), typy, stany, próg. |

## Jak liczone są dane

1. Typy i stany pobierane są z procesu projektu (`_apis/wit/workitemtypes`), więc działa to z Agile, Scrum, CMMI, Basic i procesami dziedziczonymi.
   - Domyślne typy: kategorie Requirement i Bug (np. User Story + Bug albo Product Backlog Item + Bug).
   - Domyślne stany: wszystkie w kategoriach **InProgress** i **Resolved** (np. Active, Resolved, a także własne stany typu OnHold czy For Testing, jeśli należą do tych kategorii).
2. Zapytanie WIQL zwraca otwarte elementy w wybranych stanach. Dla zespołu dodawany jest filtr po jego obszarach (team field values, zwykle Area Path z „include children”).
3. Pola elementów pobierane są paczkami po 200 (`workitemsbatch`).
4. Jeśli w procesie brakuje `StateChangeDate`, data ostatniej zmiany stanu jest odczytywana z historii (`updates`) danego elementu.

Uprawnienia (scopes): `vso.work` (odczyt work itemów) i `vso.project` (lista zespołów). Rozszerzenie nic nie zapisuje w Azure DevOps.

## Budowanie

Wymagany Node.js 20+.

```bash
npm install
npm test            # testy logiki obliczeń
npm run build       # typecheck + bundle do dist/
npm run package     # build + paczka .vsix w out/
```

## Publikacja i instalacja

1. Załóż publishera na <https://marketplace.visualstudio.com/manage/createpublisher>.
2. Wpisz jego ID w polu `publisher` w `vss-extension.json` (albo podaj przy pakowaniu: `npm run package -- --publisher TWOJ-ID`).
3. Wgraj plik `out/*.vsix` w panelu publishera (**New extension → Azure DevOps**). Rozszerzenie jest prywatne (`"public": false`).
4. W panelu publishera: **Share** → nazwa organizacji Azure DevOps.
5. W organizacji: **Organization settings → Extensions → Shared** → zainstaluj.

Do testów obok wersji produkcyjnej: `npm run package:dev` tworzy osobne rozszerzenie `aging-wip-dev`.

## Struktura

```
src/core/compute.ts   obliczenia (wiek, czas w stanie, domyślne typy i stany, podsumowanie) – czyste funkcje
src/core/data.ts      pobieranie danych z REST API Azure DevOps
src/core/chart.ts     wykres SVG, tooltip, legenda
src/hub/hub.ts        hub w Boards
src/widget/           widget dashboardu i jego konfiguracja
static/               HTML i CSS (paleta z prezentacji, jasny i ciemny motyw)
vss-extension.json    manifest rozszerzenia
```

## Ograniczenia

- WIQL zwraca maksymalnie 20 000 elementów.
- Wiek liczony jest od utworzenia elementu, tak jak w prezentacji, a nie od wejścia w pracę.
- Masowe zmiany stanu (np. hurtowe przeniesienie elementów) resetują „dni w obecnym stanie”, bo tak działa `StateChangeDate`.
