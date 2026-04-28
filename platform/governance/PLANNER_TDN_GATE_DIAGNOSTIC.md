# Planner TDN Gate Diagnostic

**Date:** 2026-04-28  
**Status:** ✅ TDN Loading Fixed | ⚠️ LLM Phase Generation Blocking  
**Test Pipeline:** pipe-2026-04-28-010b49f9

## ✅ FIXED: TDN Loading Narrowness

### Previous State (Before Fix)
- **TDN_ROOTS:** `["docs/design", "docs/architecture"]`
- **Files Loaded:** 3+ (design_system.md, ux_principles.md, interaction_patterns.md, ARCH_CORE_reference_system.md, plus TDN)
- **Problem:** Design reference documents and architecture overviews were loaded as if they were TDN approval gates
- **Status:** ❌ FAILED — Treated non-blocking docs as gate blockers

### Current State (After Fix)
- **TDN_ROOTS:** `["docs/design/tdn"]` (narrowed from docs/design/)
- **Superseded Skip:** Added logic to skip `docs/design/tdn/superseded/` directory
- **Files Loaded:** 1 (only TDN-UI-main-window-aesthetic.md)
- **Design Refs Excluded:** design_system.md, ux_principles.md, interaction_patterns.md, accessibility.md
- **Architecture Excluded:** ARCH_CORE_reference_system.md
- **Status:** ✅ CORRECT — Only Approved TDNs loaded, no reference docs

### Code Changes
**File:** `platform/backend-api/src/services/design-input-gate.service.ts`

1. **Line 12:** TDN_ROOTS narrowed
   ```typescript
   const TDN_ROOTS = ["docs/design/tdn"];  // was ["docs/design", "docs/architecture"]
   ```

2. **Lines 252-259:** Superseded directory skip
   ```typescript
   if (entry.isDirectory()) {
     // Skip archive/superseded directories — don't load old/replaced artifacts
     if (/^superseded$/i.test(entry.name)) continue;
     
     const nested = await this.collectFiles(abs, repoRoot, depth + 1, maxDepth, limit - out.length);
     out.push(...nested);
     continue;
   }
   ```

### Commits
- **ai-project_template:** 57b0866 (docs: clarify TDN path)
- **ai-delivery-platform:** fafc3ec (TDN_ROOTS + superseded skip), 00979d7 (exclude architecture/)

### Verification Output
```
Planner: 📚 Design inputs loaded: 2 FR/PRD, 0 ADR, 1 TDN file(s) from project `phks`
```
✅ Correct: 1 TDN instead of 3+

---

## ⚠️ REMAINING BLOCKER: LLM Phase Planning

### Error
```
Planner cannot create a phase plan because required TDN dependencies are missing or not human-approved.
Approve all required TDNs first, then rerun Planner.

Stack: PlannerScript.assertApprovedDependencies() line 645
```

### Analysis
The Planner's validation gate (`assertApprovedDependencies()`) performs a two-stage check:

1. **Stage 1 - Load TDNs:** ✅ PASS
   - Loads: 1 Approved TDN (TDN-UI-main-window-aesthetic, Status: Approved)
   - Excludes: Reference docs, architecture overviews, superseded TDNs

2. **Stage 2 - Validate LLM Output:** ❌ FAIL
   - LLM generates a phase plan with `required_design_artifacts` list
   - Planner validates that all `required_design_artifacts` (type: TDN) are in the loaded set AND have Status: Approved
   - The LLM is generating a phase plan that lists TDN requirements not matching loaded TDNs

### Why It Fails
The LLM-generated phase plan's `required_design_artifacts` section likely contains:
- **TDN titles that don't exist** in the project yet (TDNs haven't been created for all features)
- **OR** TDN titles that don't match the exact string in loaded TDN files

### Project Context
**Available Artifacts:**
- 1 FRD: `FRD_UI_main_window_aesthetic.md` (5 FRs)
- 1 TDN: `TDN-UI-main-window-aesthetic.md` (Approved)
- 1 PRD: `PRD_CORE_platform_foundation.md` (no specific TDN requirements)

**Unclaimed FRs:** 5 (per Planner logs)

### Title Matching Logic
The Planner uses `normalizeTitle()` to match TDN requirements against loaded TDNs:
```typescript
const requiredNorm = this.normalizeTitle(required.title);
const matched = tdnIndex.find(
  (tdn) =>
    tdn.normalizedTitle === requiredNorm ||
    tdn.normalizedTitle.includes(requiredNorm) ||
    requiredNorm.includes(tdn.normalizedTitle)
);
```

If the LLM generates a required TDN title that doesn't match `TDN-UI-main-window-aesthetic` with any of these strategies, the validation fails.

---

## Resolution Options

### Option 1: ✅ RECOMMENDED — Create Missing TDNs
**Approach:** Create TDN files for whatever the LLM phase plan requires

**Pros:**
- Fully aligns design process: TDNs gate implementation
- Clear requirements for what must be designed

**Cons:**
- May need to create multiple TDNs if LLM is ambitious
- Requires manual TDN authoring

**Next Steps:**
1. Run Planner with debug logging to capture exact `required_design_artifacts` list
2. Create TDN files for each required artifact
3. Mark as Status: Approved (or Approved-Draft if under review)
4. Rerun Planner

### Option 2: Loosen Planner Gate (Not Recommended)
**Approach:** Allow phase planning without TDN approval if FRs don't explicitly require TDNs

**Pros:**
- Unblocks Planner immediately
- Allows phases without TDNs

**Cons:**
- Weakens governance (design decisions might not be validated before implementation)
- Violates AI_DESIGN_PROCESS.md gate requirements

**Code Change Needed:**
```typescript
// In role-planner.script.ts, modify gate to allow missing TDNs if FRD doesn't require them
if (tdnDependencyIssues.length > 0 && frdRequiresTdns) {
  throw new HttpError(...)
}
```

### Option 3: Improve LLM Prompt (Moderate Effort)
**Approach:** Guide LLM to generate realistic TDN requirements based on loaded artifacts

**Pros:**
- LLM adapts to available artifacts
- Reduces unnecessary TDN creation

**Cons:**
- Requires tweaking system/user prompts
- May still generate requirements for missing TDNs

**File to Update:** `planner.agent.md` prompt section

---

## Recommended Next Step

**Debug the exact LLM output** to see what TDN titles are being required:

```powershell
# Add temporary logging to role-planner.script.ts
# In assertApprovedDependencies(), before throwing:
console.log("Required TDNs from LLM:", JSON.stringify(requiredTdns, null, 2));
console.log("Loaded TDNs:", JSON.stringify(tdnIndex, null, 2));

# Recompile and run test pipeline
npm run dev
npx tsx src/index.ts pipeline-create --entry-point "planner" --execution-mode "next"

# Check logs to see exact mismatch
```

Once we know what TDN titles the LLM wants, we can either:
- Create matching TDNs, or
- Adjust the LLM prompt to be more conservative

---

## Architecture Summary

| Component | Status | Notes |
|-----------|--------|-------|
| TDN File Loading (`design-input-gate.service.ts`) | ✅ Fixed | Loads only TDNs from `docs/design/tdn/`, skips superseded/ |
| Reference Doc Exclusion | ✅ Fixed | design_system.md, ux_principles.md not loaded |
| Architecture Doc Exclusion | ✅ Fixed | ARCH_CORE_reference_system.md not loaded |
| LLM Phase Generation | ⚠️ Needs Investigation | LLM generating unrealistic TDN requirements |
| Approval Validation | ✅ Working | Correctly validates Status: Approved |

The TDN loading system is now correct and properly gated. The remaining issue is in the LLM's phase planning logic, not in the infrastructure.
