import { Layout, Spin, Alert, Empty } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { TitleBar } from "./TitleBar";
import { PermissionsList } from "./PermissionsList";
import { PermissionDetails } from "./PermissionDetails";
import { PermissionComparison } from "./PermissionComparison";
import { usePermissions } from "../hooks/usePermissions";

const { Header, Sider, Content } = Layout;
const APP_TITLE = "Graph permission comparer";

export const AppLayout = () => {
  const { permissions, descriptions, applicationDescriptions, isLoading, error } = usePermissions();
  // The selected permission is the /permissions/$name route param, so links and refreshes keep it
  const { name: selectedPermission = null } = useParams({ strict: false });
  const navigate = useNavigate();
  const setSelectedPermission = (name: string | null) =>
    name ? navigate({ to: "/permissions/$name", params: { name } }) : navigate({ to: "/" });
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);

  const selectedPermissionData = selectedPermission 
    ? permissions.find(p => p.name === selectedPermission) || null
    : null;

  useEffect(() => {
    document.title = selectedPermission ? `${selectedPermission} · ${APP_TITLE}` : APP_TITLE;
  }, [selectedPermission]);

  const selectedPermissionsData = selectedForComparison
    .map(name => permissions.find(p => p.name === name))
    .filter(Boolean) as typeof permissions;

  const handleComparisonToggle = (permissionName: string) => {
    setSelectedForComparison(prev => 
      prev.includes(permissionName)
        ? prev.filter(name => name !== permissionName)
        : [...prev, permissionName]
    );
  };

  const handleComparisonModeToggle = () => {
    setComparisonMode(!comparisonMode);
    if (!comparisonMode) {
      setSelectedPermission(null); // Clear single selection when entering comparison mode
    } else {
      setSelectedForComparison([]); // Clear comparison selection when leaving comparison mode
    }
  };

  const handleClearComparison = () => {
    setSelectedForComparison([]);
  };

  const handleRemoveFromComparison = (permissionName: string) => {
    setSelectedForComparison(prev => prev.filter(name => name !== permissionName));
  };

  if (error) {
    return (
      <Layout style={{ minHeight: "100vh" }}>
        <Header style={{ padding: 0 }}>
          <TitleBar />
        </Header>
        <Content style={{ padding: "24px" }}>
          <Alert
            message="Error Loading Permissions"
            description={error}
            type="error"
            showIcon
          />
        </Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header style={{ padding: 0 }}>
        <TitleBar />
      </Header>
      <Layout style={{ backgroundColor: '#1B1A19FF' }}>
        <Sider 
          width={400} 
          style={{ 
            backgroundColor: '#252423FF',
            borderRight: '1px solid #303030'
          }}
        >
          <PermissionsList
            permissions={permissions}
            selectedPermission={selectedPermission}
            onPermissionSelect={setSelectedPermission}
            isLoading={isLoading}
            comparisonMode={comparisonMode}
            selectedForComparison={selectedForComparison}
            onComparisonToggle={handleComparisonToggle}
            onComparisonModeToggle={handleComparisonModeToggle}
            onClearComparison={handleClearComparison}
          />
        </Sider>
        
        <Content style={{ backgroundColor: '#1B1A19FF' }}>
          {isLoading ? (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <Spin size="large" />
            </div>
          ) : comparisonMode ? (
            <PermissionComparison
              selectedPermissions={selectedPermissionsData}
              descriptions={descriptions}
              onRemovePermission={handleRemoveFromComparison}
            />
          ) : selectedPermission && !selectedPermissionData ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
              <Empty
                description={`Permission "${selectedPermission}" was not found`}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          ) : (
            <PermissionDetails 
              permission={selectedPermissionData}
              descriptions={descriptions}
              applicationDescriptions={applicationDescriptions}
            />
          )}
        </Content>
      </Layout>
    </Layout>
  );
};
