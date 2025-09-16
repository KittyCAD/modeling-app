
/**
 * When the router switches from one /file route to another /file route
 * the entire DOM tree will not unmount and mount. This means <App/> will not remount
 * 
 * If a connection is established with the engine and a /file route happens we need to execute the code
 */
export const useOnFileRoute = () => {

}