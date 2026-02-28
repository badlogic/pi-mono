/**
 * D-Bus introspection XML for the org.embry.Agent interface.
 *
 * Defines the contract between the D-Bus bridge and any surface client
 * (KDE launcher, Tauri, voice, Stream Deck, etc.)
 */

export const DBUS_BUS_NAME = "org.embry.Agent";
export const DBUS_OBJECT_PATH = "/org/embry/Agent";
export const DBUS_INTERFACE_NAME = "org.embry.Agent";

export const INTROSPECTION_XML = `
<!DOCTYPE node PUBLIC "-//freedesktop//DTD D-BUS Object Introspection 1.0//EN"
  "http://www.freedesktop.org/standards/dbus/1.0/introspect.dtd">
<node>
  <interface name="org.embry.Agent">

    <!-- Methods -->
    <method name="Ask">
      <arg name="prompt" type="s" direction="in"/>
      <arg name="response" type="s" direction="out"/>
    </method>

    <method name="AskAsync">
      <arg name="prompt" type="s" direction="in"/>
      <arg name="requestId" type="s" direction="out"/>
    </method>

    <method name="Steer">
      <arg name="message" type="s" direction="in"/>
    </method>

    <method name="FollowUp">
      <arg name="message" type="s" direction="in"/>
    </method>

    <method name="Abort"/>

    <method name="GetState">
      <arg name="state" type="s" direction="out"/>
    </method>

    <method name="SetModel">
      <arg name="provider" type="s" direction="in"/>
      <arg name="model" type="s" direction="in"/>
    </method>

    <method name="RespondToUI">
      <arg name="id" type="s" direction="in"/>
      <arg name="response" type="s" direction="in"/>
    </method>

    <method name="Ping">
      <arg name="result" type="s" direction="out"/>
    </method>

    <method name="AskWithHints">
      <arg name="prompt" type="s" direction="in"/>
      <arg name="hints" type="s" direction="in"/>
      <arg name="response" type="s" direction="out"/>
    </method>

    <method name="AskAs">
      <arg name="persona" type="s" direction="in"/>
      <arg name="prompt" type="s" direction="in"/>
      <arg name="response" type="s" direction="out"/>
    </method>

    <!-- Signals -->
    <signal name="MessageUpdate">
      <arg name="text" type="s"/>
    </signal>

    <signal name="ToolExecution">
      <arg name="name" type="s"/>
      <arg name="args" type="s"/>
    </signal>

    <signal name="AgentEnd">
      <arg name="response" type="s"/>
    </signal>

    <signal name="ExtensionUIRequest">
      <arg name="id" type="s"/>
      <arg name="method" type="s"/>
      <arg name="title" type="s"/>
      <arg name="options" type="s"/>
    </signal>

    <signal name="Ready"/>

    <signal name="Error">
      <arg name="message" type="s"/>
    </signal>

    <!-- Properties -->
    <property name="IsStreaming" type="b" access="read"/>
    <property name="CurrentModel" type="s" access="read"/>
    <property name="SessionName" type="s" access="read"/>

  </interface>
</node>
`;
