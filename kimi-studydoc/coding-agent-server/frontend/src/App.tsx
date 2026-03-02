import { useState, useEffect } from 'react';
import { 
  Layout, Card, Button, Input, Form, Typography, Space, 
  Tag, Empty, message, Row, Col
} from 'antd';
import { 
  PlayCircleOutlined, SearchOutlined, DeleteOutlined, 
  StopOutlined, PlusOutlined, RocketOutlined 
} from '@ant-design/icons';

const { Header, Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

interface Session {
  sessionId: string;
  state: string;
  createdAt: number;
  updatedAt: number;
  progress?: { current: number; total: number };
  error?: string;
}

const API_BASE = '/api';

const getStateTag = (state: string) => {
  switch (state) {
    case 'EXECUTING': return <Tag color="processing">EXECUTING</Tag>;
    case 'COMPLETE': return <Tag color="success">COMPLETE</Tag>;
    case 'FAILED': return <Tag color="error">FAILED</Tag>;
    case 'FROZEN': return <Tag color="cyan">FROZEN</Tag>;
    case 'PREFLIGHT': return <Tag color="purple">PREFLIGHT</Tag>;
    default: return <Tag color="default">{state}</Tag>;
  }
};

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [form] = Form.useForm();

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE}/sessions`);
      const json = await res.json();
      if (json.success) {
        const detailed = await Promise.all(json.data.map(async (s: any) => {
          const detailRes = await fetch(`${API_BASE}/sessions/${s.sessionId}`);
          const detailJson = await detailRes.json();
          return { ...s, ...detailJson.data };
        }));
        setSessions(detailed);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  };

  useEffect(() => {
    fetchSessions();
    const timer = setInterval(fetchSessions, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleCreate = async (values: any) => {
    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      });
      if (res.ok) {
        message.success('Session initialized successfully');
        form.resetFields();
        fetchSessions();
      }
    } catch (err) {
      message.error('Failed to create session');
    }
  };

  const runAction = async (id: string, action: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${id}/${action}`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (res.ok) {
        message.info(`Action ${action} triggered`);
        fetchSessions();
      }
    } catch (err) {
      message.error(`${action} failed`);
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
      message.success('Session deleted');
      fetchSessions();
    } catch (err) {
      message.error('Delete failed');
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#001529', padding: '0 40px', display: 'flex', alignItems: 'center' }}>
        <RocketOutlined style={{ fontSize: '24px', color: '#fff', marginRight: '16px' }} />
        <Title level={3} style={{ color: '#fff', margin: 0 }}>Coding Agent Monitor</Title>
      </Header>
      
      <Content style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <Card bordered={false} style={{ marginBottom: '40px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
          <Title level={4}><PlusOutlined /> New Coding Task</Title>
          <Form 
            form={form} 
            layout="vertical" 
            onFinish={handleCreate}
            initialValues={{ skillText: '## Coding Skill\n- Read file\n- Write code\n- Run tests' }}
          >
            <Row gutter={24}>
              <Col span={12}>
                <Form.Item name="userPrompt" label="User Prompt" rules={[{ required: true }]}>
                  <TextArea rows={4} placeholder="Describe what the agent should do..." />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="skillText" label="Skill YAML/MD" rules={[{ required: true }]}>
                  <TextArea rows={4} style={{ fontFamily: 'monospace' }} />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />} size="large">
              Initialize Session
            </Button>
          </Form>
        </Card>

        <Title level={4} style={{ marginBottom: '20px' }}>Active Sessions</Title>
        {sessions.length === 0 ? (
          <Empty description="No tasks found" />
        ) : (
          sessions.sort((a,b) => b.createdAt - a.createdAt).map(s => (
            <Card 
              key={s.sessionId} 
              style={{ marginBottom: '20px', borderRadius: '12px' }}
              bodyStyle={{ padding: '24px' }}
              actions={[
                s.state === 'INIT&& <Button type="link" key="preflight" icon={<SearchOutlined />} onClick={() => runAction(s.sessionId, 'preflight')}>Check Dependencies</Button>,
                (s.state === 'PREFLIGHT' || s.state === 'FROZEN') && <Button type="link" key="execute" icon={<PlayCircleOutlined />} onClick={() => runAction(s.sessionId, 'execute')}>Start Execution</Button>,
                s.state === 'EXECUTING&& <Button type="link" danger key="abort" icon={<StopOutlined />} onClick={() => runAction(s.sessionId, 'abort')}>Abort</Button>,
                <Button type="link" danger key="delete" icon={<DeleteOutlined />} onClick={() => deleteSession(s.sessionId)}>Delete</Button>
              ].filter(Boolean) as React.ReactNode[]}
            >
              <Space direction="vertical" size={2}>
                <Space>
                  <Text strong style={{ fontSize: '16px' }}>Session: {s.sessionId.slice(0, 8)}...</Text>
                  {getStateTag(s.state)}
                </Space>
                <Text type="secondary" style={{ fontSize: '12px' }}>Created at {new Date(s.createdAt).toLocaleString()}</Text>
              </Space>

              {s.state === 'EXECUTING&& s.progress && (
                <div style={{ marginTop: '15px' }}>
                  <div style={{ height: '8px', background: '#eee', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${(s.progress.current / s.progress.total) * 100}%`, height: '100%', background: '#2563eb', transition: 'width 0.5s' }} /></div>
                  <div style={{ fontSize: '11px', textAlign: 'right', marginTop: '5px', color: '#666' }}>{s.progress.current} / {s.progress.total} Steps</div>
                </div>
              )}

              {s.error && (
                <div style={{ marginTop: '10px', padding: '12px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: '8px' }}>
                  <Space align="start">
                    <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                    <Text type="danger">{s.error}</Text>
                  </Space>
                </div>
              )}
            </Card>
          ))
        )}
      </Content>
    </Layout>
  );
}
