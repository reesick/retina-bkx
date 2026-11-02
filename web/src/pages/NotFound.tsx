import { Link } from "react-router-dom";
import { Page } from "../components/Page";
import { Ring } from "../components/Ring";

export default function NotFound() {
  return (
    <Page>
      <div className="flex flex-col items-center py-24 text-center">
        <Ring value={0.25} size={120} stroke={6} />
        <h1 className="mt-6 text-title-xl">Nothing here.</h1>
        <Link to="/" className="btn-white mt-6">Back to Today</Link>
      </div>
    </Page>
  );
}
