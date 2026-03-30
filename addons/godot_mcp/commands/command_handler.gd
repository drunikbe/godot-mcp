@tool
class_name MCPCommandHandler
extends Node
## Routes tool calls to the appropriate command processor.
##
## Uses Chain of Responsibility: iterates registered processors and
## delegates to the first one that handles the tool name.

var _command_processors: Array[MCPBaseCommandProcessor] = []


func _ready() -> void:
	print("[CommandHandler] Initializing...")
	await get_tree().process_frame
	_initialize_processors()
	print("[CommandHandler] Ready with %d processors" % _command_processors.size())


func _initialize_processors() -> void:
	var specs: Array[Array] = [
		[MCPFileCommands, "FileCommands"],
		[MCPSceneCommands, "SceneCommands"],
		[MCPScriptCommands, "ScriptCommands"],
		[MCPProjectCommands, "ProjectCommands"],
		[MCPAssetCommands, "AssetCommands"],
		[MCPRuntimeCommands, "RuntimeCommands"],
		[MCPVisualizerCommands, "VisualizerCommands"],
	]
	for spec in specs:
		var script_class = spec[0]
		var label: String = spec[1]
		if script_class == null:
			push_error("[CommandHandler] Class for %s is null — script may have a parse error" % label)
			continue
		if not script_class.can_instantiate():
			push_error("[CommandHandler] %s cannot be instantiated — check script for errors" % label)
			continue
		_register_processor(script_class.new(), label)


func _register_processor(processor: MCPBaseCommandProcessor, node_name: String) -> void:
	processor.name = node_name
	_command_processors.append(processor)
	add_child(processor)


## Get a registered processor by its node name.
func get_processor(node_name: String) -> MCPBaseCommandProcessor:
	for processor in _command_processors:
		if processor.name == node_name:
			return processor
	return null


## Execute a tool command by finding the right processor.
## Returns a Dictionary with &"ok": bool and either result data or &"error": String.
func execute_command(tool_name: String, args: Dictionary) -> Dictionary:
	for processor in _command_processors:
		if processor.handles_tool(tool_name):
			return await processor.process_command(tool_name, args)

	return {&"ok": false, &"error": "Unknown tool: %s" % tool_name}
