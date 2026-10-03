import {NotFoundView} from "../components/not-found-view";
import {SiteNav} from "../components/site-nav";

/** Unknown URLs. These sit outside the site layout, so this page brings its own nav. */
export default function NotFound() {
  return (
    <>
      <SiteNav />
      <div id="main" className="flex-1">
        <NotFoundView />
      </div>
    </>
  );
}
