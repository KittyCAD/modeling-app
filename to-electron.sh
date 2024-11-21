#!/bin/sh

FILE="$1"

sg run --update-all \
--pattern 'await $_A.waitForAuthSkipAppStart()' \
--rewrite 'await homePage.goToModelingScene()' \
"$FILE"

sg --update-all \
--pattern 'test($DESC, async ({ page, $$$ARGS }) => { $$$BODY })' \
--rewrite 'test($DESC, async ({ page, $$$ARGS homePage }) => { $$$BODY })' \
"$FILE"

sg --update-all \
--pattern 'test($DESC, async ({ page }) => { $$$BODY })' \
--rewrite 'test($DESC, async ({ page, homePage }) => { $$$BODY })' \
"$FILE"

sg --update-all \
--pattern 'test($DESC, $OPT, async ({ page }) => { $$$BODY })' \
--rewrite 'test($DESC, $OPT, async ({ page, homePage }) => { $$$BODY })' \
"$FILE"

sg --update-all --pattern 'test.beforeEach($$$)' --rewrite '' "$FILE"
sg --update-all --pattern 'test.afterEach($$$)' --rewrite '' "$FILE"

# Unfortunately some tests are tied to the viewport size.
# sg --update-all --pattern 'await page.setViewportSize($$$ARGS)' --rewrite '' "$FILE"
sg --update-all --pattern "await page.goto('/')" --rewrite '' "$FILE"

sg --update-all --pattern 'await page.setViewportSize($$$ARGS)' --rewrite 'await page.setBodyDimensions($$$ARGS)' "$FILE"

sed -i -e 's/@playwright\/test/.\/zoo-test/' "$FILE"
sed -i -e 's/, setup, tearDown,//' "$FILE"
sed -i -e 's/setup, tearDown,//' "$FILE"
sed -i -e 's/setup, tearDown//' "$FILE"
