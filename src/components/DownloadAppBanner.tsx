const DownloadAppBanner = () => {
  return (
    <div className="fixed inset-0 top-auto z-50 bg-warn-20 text-warn-80 px-8 py-4">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-xl font-bold mb-4">
          KittyCAD Modeling App is better as a desktop app!
        </h2>
        <p>
          The browser version of the app only saves your data temporarily in{' '}
          <code className="text-base inline-block px-0.5 bg-warn-30/50 rounded">
            localStorage
          </code>
          , and isn't backed up anywhere! Visit{' '}
          <a
            href="https://github.com/KittyCAD/modeling-app/releases"
            rel="noopener noreferrer"
            target="_blank"
            className="text-warn-80 dark:text-warn-80 dark:hover:text-warn-70 underline"
          >
            our GitHub repository
          </a>{' '}
          to download the app for the best experience.
        </p>
      </div>
    </div>
  )
}

export default DownloadAppBanner
