// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { breakthroughProfile } from "@/application/gameData/setup"
import BuildTab from "@/features/build/BuildTab"
import {
  buildAffixLimit,
  buildPresetInventory,
  defaultBuildPresets,
  gearData,
  maxAffixCount,
  normalizeBuildSetup,
  summarizeGearAffixes,
  type BuildEntry,
  type GearItem,
} from "@/gear"
import { defaultGlobalDebuffs } from "@/globalDebuffs"
import { useGearStore } from "@/stores/gearStore"

import { weaponPair } from "./helpers/weaponPair"

vi.mock("@/features/build/useBuildThroughputs", () => ({
  useBuildThroughputs: () => ({
    viewed: { dps: 200, hps: 0, totalDamage: 2000 },
    active: { dps: 100, hps: 0, totalDamage: 1000 },
  }),
}))
vi.mock("@/notices", () => ({ publishNotice: () => {}, dismissNotice: () => {} }))
vi.mock("@/i18n", () => ({
  getLocale: () => "en",
  t: (key: string, parameters: Record<string, string | number> = {}) => [key, ...Object.values(parameters)].join(" "),
  gameText: (value: string) => value,
  dataText: (_key: string, value: string) => value,
}))

const preset = defaultBuildPresets[0]
const weapons = weaponPair(preset.martialArts)
const affixId = "maxPhys"
const affixLimit = maxAffixCount(affixId, weapons)

function customBuild(affixTargets: Record<string, number>): BuildEntry {
  return {
    id: "mine",
    name: "Mine",
    martialArts: [...weapons],
    equipped: {},
    setup: normalizeBuildSetup({}),
    affixTargets,
  }
}

const affixHeading = (container: HTMLElement) =>
  container.querySelector(".build-affix-summary-heading span")?.textContent

function addTargetControls(container: HTMLElement) {
  return {
    picker: container.querySelector<HTMLSelectElement>('select[aria-label="ui.buildTab.addAffixTarget"]')!,
    addButton: container.querySelector<HTMLButtonElement>(".build-affix-target-add button")!,
  }
}

async function mountBuild(entry: BuildEntry, gearItems: GearItem[] = []) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  useGearStore.setState({ buildState: { entries: [entry], gearItems, activeBuildId: entry.id } })
  const settings = { weapons, breakthrough: "17", ping: 40 }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  function Owner() {
    const state = useGearStore(store => store.buildState)
    return createElement(BuildTab, {
      pathId: "stonesplitStrength",
      builds: state.entries,
      visibleItems: state.gearItems,
      weapons,
      martialArtTags: [],
      graduatedBuildIds: [],
      onActiveBuildChange: () => {},
      onSelectBuildWeapons: () => true,
      activeRotation: { name: "Test", steps: [] },
      measurement: {
        environment: {
          pathId: "stonesplitStrength",
          settings,
          enemy: breakthroughProfile(settings),
          globalDebuffs: defaultGlobalDebuffs,
          setupSelections: { food: "None", script: "None", divinecraft: "None" },
          skillOverrides: {},
          previewId: null,
        },
        statOverrides: {},
        attunementOverrides: {},
      },
    })
  }
  await act(async () => root.render(createElement(Owner)))
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    },
  }
}

const storedTargets = () => useGearStore.getState().buildState.entries[0].affixTargets

function targetInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(".build-affix-target-controls input")
}

async function type(input: HTMLInputElement, raw: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, raw)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function blur(input: HTMLInputElement) {
  // React implements onBlur through the bubbling focusout event.
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })))
}

it("lets a custom build's target be cleared and retyped, committing a whole number on blur", async () => {
  const { container, cleanup } = await mountBuild(customBuild({ [affixId]: 2 }))
  try {
    const input = targetInput(container)!
    expect(input.disabled).toBe(false)
    expect(affixHeading(container)).toBe("ui.buildTab.affixTargetProgress 0 2")

    await type(input, "")
    expect(input.value).toBe("")
    expect(storedTargets()).toEqual({ [affixId]: 2 })

    await type(input, "5")
    await blur(input)
    expect(storedTargets()).toEqual({ [affixId]: 5 })
    expect(affixHeading(container)).toBe("ui.buildTab.affixTargetProgress 0 5")

    await type(input, "2.6")
    await blur(input)
    expect(storedTargets()).toEqual({ [affixId]: 3 })

    await type(input, "")
    await blur(input)
    expect(storedTargets()).toEqual({ [affixId]: 1 })
    expect(targetInput(container)!.value).toBe("1")

    await type(input, "99")
    await blur(input)
    expect(storedTargets()).toEqual({ [affixId]: affixLimit })
  } finally {
    await cleanup()
  }
})

it("offers only affixes this build's gear can hold and stops at the build's total affix lines", async () => {
  const unreachable = Object.keys(gearData.affixes).filter(key => maxAffixCount(key, weapons) === 0)
  expect(unreachable.length).toBeGreaterThan(0)
  // 34 filler lines plus 4 Max Physical Attack leaves 2 of the build's 40 lines unclaimed.
  const fillers = Object.keys(gearData.affixes).filter(key => key !== affixId && maxAffixCount(key, weapons) >= 10)
  const fillerTargets = Object.fromEntries([10, 10, 10, 4].map((target, index) => [fillers[index], target]))
  expect(buildAffixLimit()).toBe(40)
  const { container, cleanup } = await mountBuild(customBuild({ ...fillerTargets, [affixId]: 4 }))
  try {
    const { picker, addButton } = addTargetControls(container)
    const options = new Set([...picker.options].map(option => option.value))
    expect(unreachable.some(key => options.has(key))).toBe(false)
    expect(picker.disabled).toBe(false)

    const input = [...container.querySelectorAll<HTMLLIElement>(".build-affix-target-row")]
      .find(row => row.textContent?.includes(gearData.affixes[affixId]!.name))!
      .querySelector("input")!
    await type(input, "12")
    await blur(input)
    expect(storedTargets()?.[affixId]).toBe(6)
    expect(addButton.disabled).toBe(true)
    expect(picker.disabled).toBe(true)
  } finally {
    await cleanup()
  }
})

it("hides the add-target controls on a preset build", async () => {
  const { container, cleanup } = await mountBuild({
    id: preset.id,
    name: preset.name,
    isDefault: true,
    presetId: preset.id,
    martialArts: [...preset.martialArts],
  })
  try {
    expect(container.querySelector(".build-affix-target-add")).toBeNull()
    expect(affixHeading(container)).toMatch(/^ui\.buildTab\.affixTotal \d+$/)
  } finally {
    await cleanup()
  }
})

it("counts equipped affixes toward the heading only up to each target", async () => {
  const inventory = buildPresetInventory(preset)
  const counts = summarizeGearAffixes(
    Object.values(inventory.equipped).map(id => inventory.items.find(item => item.id === id)),
  )
  const surplus = counts.affixes.find(affix => affix.count > 1)!
  const short = counts.affixes.find(affix => affix !== surplus && affix.count < maxAffixCount(affix.key, weapons))!
  const shortTarget = short.count + 1
  const { container, cleanup } = await mountBuild(
    { ...customBuild({ [surplus.key]: 1, [short.key]: shortTarget }), equipped: inventory.equipped },
    inventory.items,
  )
  try {
    expect(affixHeading(container)).toBe(`ui.buildTab.affixTargetProgress ${1 + short.count} ${1 + shortTarget}`)
  } finally {
    await cleanup()
  }
})
