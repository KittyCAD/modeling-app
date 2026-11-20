# Experimental STEP conversion

Extends the STEP menu experiment in #13616 with background status and retry.

Choose **Convert file…** from the project menu or **Convert File to Editable
KCL… (Experimental)** from the desktop File menu, then select a STEP/STP file.
Confirm reasoning-credit usage to start a separate Zookeeper conversation.
The status panel stays visible while you work or switch projects. **Open KCL**
saves the result in a new folder in the original project; reopening preserves
your edits.

Source files, status, and results are saved locally per account. Conversion runs
while ZDS is open. After a reload or connection failure, retry starts a new
credit-bearing attempt from the saved source. Failed attempts never restart
automatically. Check the generated geometry and parameter edits before use.

## Validation

Focused tests cover file selection, credit confirmation, queue status, account
isolation, recovery, retry, output validation, and saving/opening KCL:

```sh
npx vitest run --project unit src/lib/stepConversion.test.ts \
  src/components/StepConversions.test.tsx src/hooks/useStepFilePicker.test.tsx \
  src/lib/stepToKcl.test.ts
npx vitest run --project integration --retry 0 src/lib/stepConversion.spec.ts
```

The native-menu test checks selection and confirmation without starting paid
inference. A complete live conversion through ZDS has not been validated.
