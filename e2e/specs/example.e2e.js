describe("Hello Tauri", () => {
  it("should be cordial", async () => {
    const header = await $("body > h1");
    const text = await header.getText();
    expect(text).toMatch(/^[hH]ello/);
  })
})