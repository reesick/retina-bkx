import { useLocation } from "react-router-dom";

/**
 * True while the current URL belongs to this page. During a framer-motion exit animation the old page stays
 * mounted but the router location has already changed, so heavy children (WebGL canvases) can unmount at once.
 */
export function useRouteActive(test: (pathname: string) => boolean): boolean {
  const { pathname } = useLocation();
  return test(pathname);
}
