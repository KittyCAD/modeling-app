describe("Hello Tauri", () => {
  it("should be cordial", async () => {
    const header = await $("h1");
    const text = await header.getText();
    expect(text).toMatch(/^Sign in to get started with the KittyCAD Modeling App/);
  })
})