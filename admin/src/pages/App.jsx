import HomePage from './HomePage';
import LicenseGuard from '../components/LicenseGuard';

const App = () => {
  return (
    <LicenseGuard>
      <HomePage />
    </LicenseGuard>
  );
};

export default App;
